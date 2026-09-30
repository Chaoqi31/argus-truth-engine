"""Failure and reuse paths of the audit pipeline, over the real HTTP clients.

The goldens pin the happy path. These pin what an audit does when a verifier
stalls, a verifier answer needs repair, the budget runs out, a provider is
down, the input cannot be read, the run is cancelled, or a verdict is
already cached. The budget, cancel and cache runs are also recorded for the
web's fold.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.audit import Run, extract, verify
from argus.cache.finding_cache import FindingCache
from argus.db.repository import JobRepository
from argus.llm import Transports
from argus.llm.miromind import MiroMindAccess
from argus.models.domain import (
    Agent,
    ContentDomain,
    Finding,
    FindingFlag,
    FindingVerdict,
    StageStatus,
    new_id,
)
from argus.models.job import EventFrame, FailureKind, Finished, Job, TraceOpened
from tests.fake_llm import AUDIT_TEXT, S5, FakeLLM
from tests.golden import audit_settings, fake_llm_server, llm_calls, record_run, replayed


def _text_job() -> Job:
    return Job(
        id=new_id("job"),
        input_text=AUDIT_TEXT,
        input_mode="text",
        content_domain=ContentDomain.FINANCE,
    )


async def _audit(
    fake: FakeLLM,
    *,
    cheap_llm: bool,
    job: Job | None = None,
    budget_usd: float = 50.0,
    cache: FindingCache | None = None,
    record: str | None = None,
    **overrides: Any,
) -> tuple[Job, list[EventFrame]]:
    """Extract, then verify every candidate, as the CLI does."""
    job = job or _text_job()
    initial = job.model_copy(deep=True)
    frames: list[EventFrame] = []
    with fake_llm_server(fake) as (base_url, _):
        settings = audit_settings(base_url, cheap_llm=cheap_llm, **overrides)
        async with Transports(settings) as transports:
            run = Run(
                job,
                llm=transports.for_job(MiroMindAccess.from_settings(settings)),
                cache=cache,
                settings=settings,
                budget_usd=budget_usd,
                emit=frames.append,
            )
            await extract(run)
            if job.status == "awaiting_review":
                await verify(run, [c.id for c in job.claims])
    assert replayed(initial, frames) == job
    if record is not None:
        record_run(record, initial, frames, job)
    return job, frames


def _verifier_finding(job: Job, claim_text: str) -> Finding:
    claim_id = next(c.id for c in job.claims if c.text == claim_text)
    return next(f for f in job.findings if f.agent == Agent.VERIFIER and f.claim_id == claim_id)


def _finished(frames: list[EventFrame]) -> Finished:
    event = frames[-1].event
    assert isinstance(event, Finished)
    return event


async def test_a_stalled_verifier_times_out_into_an_uncertain_finding() -> None:
    job, _ = await _audit(
        FakeLLM(stalled=frozenset({S5})), cheap_llm=False, miromind_response_timeout_s=1.0
    )

    finding = _verifier_finding(job, S5)
    assert (finding.verdict, finding.flags) == (
        FindingVerdict.UNCERTAIN,
        (FindingFlag.VERIFIER_TIMED_OUT,),
    )
    trace = job.trace(finding.reasoning_trace_id)
    assert trace.steps and trace.usage.response_ids
    assert job.status == "done"
    assert job.claims_audited == job.claims_total == 6


async def test_a_malformed_verifier_answer_is_repaired() -> None:
    fake = FakeLLM(malformed_once=frozenset({S5}))
    job, _ = await _audit(fake, cheap_llm=False)

    finding = _verifier_finding(job, S5)
    assert finding.verdict == FindingVerdict.INACCURATE
    assert FindingFlag.VERIFIER_UNPARSEABLE not in finding.flags
    assert len(job.trace(finding.reasoning_trace_id).usage.response_ids) == 2
    # Six claims, one scripted unparseable claim retried once, and one repair here.
    assert llm_calls(fake)["responses:verifier"] == 8


async def test_the_budget_stops_new_calls_and_keeps_what_they_bought() -> None:
    # DeepSeek calls are free; one verifier call costs about $0.11. One claim
    # at a time, so the budget binds between claims.
    fake = FakeLLM()
    job, frames = await _audit(
        fake,
        cheap_llm=True,
        budget_usd=0.2,
        record="budget_stops_verify",
        unified_verifier_concurrency=1,
    )

    assert job.status == "failed"
    assert 1 <= job.claims_audited < job.claims_total
    verified = [f for f in job.findings if f.agent == Agent.VERIFIER]
    assert all(f.confidence_breakdown is not None for f in verified)
    assert job.cost_usd == round(sum(t.usage.cost_usd for t in job.traces), 6) > 0.2
    assert (job.audit_report_md, llm_calls(fake).get("chat:reporter")) == (None, None)
    failure = _finished(frames).failure
    assert failure is not None and failure.kind == FailureKind.BUDGET
    assert "budget exceeded" in failure.message


async def test_a_provider_outage_fails_the_job() -> None:
    job, frames = await _audit(FakeLLM(failing=frozenset({"planner"})), cheap_llm=True)

    assert (job.status, job.findings) == ("failed", [])
    failure = _finished(frames).failure
    assert failure is not None and failure.kind == FailureKind.ERROR
    assert "500" in failure.message
    assert [s.status for s in job.stages if s.key == "planner"] == [StageStatus.FAILED]


async def test_an_unreadable_pdf_fails_the_job(tmp_path: Path) -> None:
    pdf = tmp_path / "broken.pdf"
    pdf.write_bytes(b"%PDF-1.7 truncated")
    fake = FakeLLM()
    job, frames = await _audit(
        fake, cheap_llm=True, job=Job(id=new_id("job"), pdf_path=str(pdf), input_mode="pdf")
    )

    assert job.status == "failed"
    assert fake.requests == []
    failure = _finished(frames).failure
    assert failure is not None and failure.kind == FailureKind.ERROR
    assert "could not be read" in failure.message


async def test_a_cancelled_run_ends_failed_and_keeps_what_it_found() -> None:
    job = _text_job()
    initial = job.model_copy(deep=True)
    frames: list[EventFrame] = []
    with fake_llm_server(FakeLLM(stalled=frozenset({S5}))) as (base_url, _):
        settings = audit_settings(base_url, cheap_llm=True)
        async with Transports(settings) as transports:
            run = Run(
                job,
                llm=transports.for_job(MiroMindAccess.from_settings(settings)),
                cache=None,
                settings=settings,
                budget_usd=50.0,
                emit=frames.append,
            )
            await extract(run)
            verifying = asyncio.create_task(verify(run, [c.id for c in job.claims]))
            while job.claims_audited < job.claims_total - 1:
                await asyncio.sleep(0.01)
            verifying.cancel("stopped by the test")
            await asyncio.gather(verifying, return_exceptions=True)

    assert job.status == "failed"
    assert job.failure is not None
    assert (job.failure.kind, job.failure.message) == (
        FailureKind.INTERRUPTED,
        "stopped by the test",
    )
    assert job.claims_audited == job.claims_total - 1
    stalled = [t for t in job.traces if t.completed_at is None]
    assert [t.agent for t in stalled] == [Agent.VERIFIER]
    assert all(s.status is not StageStatus.RUNNING for s in job.stages)
    assert replayed(initial, frames) == job
    record_run("cancelled_mid_verify", initial, frames, job)


async def test_a_second_audit_reuses_cached_verdicts(sqlite_engine: object) -> None:
    repo = JobRepository(async_sessionmaker(sqlite_engine, expire_on_commit=False))
    cache = FindingCache(repo.sessionmaker)
    first_fake, second_fake = FakeLLM(), FakeLLM()
    await _audit(first_fake, cheap_llm=True, cache=cache)
    job, frames = await _audit(
        second_fake, cheap_llm=True, cache=cache, record="reuses_cached_verdicts"
    )

    cached = [f for f in job.findings if f.from_cache]
    assert cached
    evidence_ids = {e.id for e in job.evidences}
    assert all(f.evidence_ids and set(f.evidence_ids) <= evidence_ids for f in cached)
    replays = [
        f.event.trace
        for f in frames
        if isinstance(f.event, TraceOpened) and f.event.trace.completed_at is not None
    ]
    assert {t.id for t in replays} == {f.reasoning_trace_id for f in cached}
    assert all(t.steps and t.usage.cost_usd == 0 for t in replays)
    step_ids = {s.id for t in replays for s in t.steps}
    cited = [e for e in job.evidences if any(e.id in f.evidence_ids for f in cached)]
    assert {e.retrieved_by_step_id for e in cited} <= step_ids
    first, second = llm_calls(first_fake), llm_calls(second_fake)
    assert second["responses:verifier"] == first["responses:verifier"] - len(cached)
