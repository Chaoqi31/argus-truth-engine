"""Failure and reuse paths of the audit pipeline, over the real HTTP clients.

The goldens pin the happy path. These pin what an audit does when a verifier
stalls, a verifier answer needs repair, the budget runs out, a provider is
down, the input cannot be read, or a verdict is already cached.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.db.repository import JobRepository
from argus.llm import Transports
from argus.llm.miromind import MiroMindAccess
from argus.models.domain import FailureKind, Finding, FindingVerdict, Job
from argus.orchestrator import audit_pdf, audit_text
from argus.trace_bus.in_process import InProcessBus
from tests.fake_llm import AUDIT_TEXT, S5, FakeLLM
from tests.golden import audit_settings, fake_llm_server, llm_calls


async def _audit(
    tmp_path: Path,
    fake: FakeLLM,
    *,
    cheap_llm: bool,
    budget_usd: float = 50.0,
    repo: JobRepository | None = None,
    **overrides: Any,
) -> tuple[Job, list[tuple[str, dict[str, Any]]]]:
    with fake_llm_server(fake) as (base_url, _):
        bus = InProcessBus()
        settings = audit_settings(base_url, cheap_llm=cheap_llm, **overrides)
        async with Transports(settings) as transports:
            job = await audit_text(
                text=AUDIT_TEXT,
                output_path=tmp_path / "findings.json",
                settings=settings,
                llm=transports.for_job(MiroMindAccess.from_settings(settings)),
                budget_usd=budget_usd,
                repo=repo,
                trace_bus=bus,
                auto_review=True,
                content_domain="finance",
            )
        async with bus.subscribe(job.id) as sub:
            events = [(ev.kind, ev.payload) async for ev in sub.iter_history()]
    return job, events


def _verifier_finding(job: Job, claim_text: str) -> Finding:
    claim_id = next(c.id for c in job.claims if c.text == claim_text)
    return next(f for f in job.findings if f.agent == "UnifiedVerifier" and f.claim_id == claim_id)


async def test_a_stalled_verifier_times_out_into_an_uncertain_finding(tmp_path: Path) -> None:
    job, _ = await _audit(
        tmp_path,
        FakeLLM(stalled=frozenset({S5})),
        cheap_llm=False,
        miromind_response_timeout_s=1.0,
    )

    finding = _verifier_finding(job, S5)
    assert (finding.verdict, finding.flags) == (FindingVerdict.UNCERTAIN, ["verifier timed out"])
    assert job.status == "done"
    assert job.claims_audited == job.claims_total == 6


async def test_a_malformed_verifier_answer_is_repaired(tmp_path: Path) -> None:
    fake = FakeLLM(malformed_once=frozenset({S5}))
    job, _ = await _audit(tmp_path, fake, cheap_llm=False)

    finding = _verifier_finding(job, S5)
    assert finding.verdict == FindingVerdict.INACCURATE
    assert "unparseable verifier response" not in finding.flags
    # Six claims, one scripted unparseable claim retried once, and one repair here.
    assert llm_calls(fake)["responses:verifier"] == 8


async def test_the_budget_stops_verification_and_keeps_what_finished(tmp_path: Path) -> None:
    # DeepSeek calls are free; one verifier call costs about $0.11.
    fake = FakeLLM()
    job, events = await _audit(tmp_path, fake, cheap_llm=True, budget_usd=0.2)

    assert job.status == "failed"
    assert 1 <= job.claims_audited < job.claims_total
    verified = [f for f in job.findings if f.agent == "UnifiedVerifier"]
    assert all(f.confidence_breakdown is not None for f in verified)
    assert (job.audit_report_md, llm_calls(fake).get("chat:reporter")) == (None, None)
    kind, payload = events[-1]
    assert kind == "failed"
    assert payload["failure"]["kind"] == FailureKind.BUDGET
    assert "budget exceeded" in payload["failure"]["message"]


async def test_a_provider_outage_fails_the_job(tmp_path: Path) -> None:
    job, events = await _audit(
        tmp_path, FakeLLM(failing=frozenset({"planner"})), cheap_llm=True
    )

    assert (job.status, job.findings) == ("failed", [])
    kind, payload = events[-1]
    assert kind == "failed"
    assert payload["failure"]["kind"] == FailureKind.ERROR
    assert "500" in payload["failure"]["message"]


async def test_an_unreadable_pdf_fails_the_job_with_a_terminal_event(tmp_path: Path) -> None:
    pdf = tmp_path / "broken.pdf"
    pdf.write_bytes(b"%PDF-1.7 truncated")
    fake = FakeLLM()
    with fake_llm_server(fake) as (base_url, _):
        bus = InProcessBus()
        settings = audit_settings(base_url, cheap_llm=True)
        async with Transports(settings) as transports:
            job = await audit_pdf(
                pdf_path=pdf,
                output_path=tmp_path / "findings.json",
                settings=settings,
                llm=transports.for_job(MiroMindAccess.from_settings(settings)),
                trace_bus=bus,
                auto_review=True,
            )
        async with bus.subscribe(job.id) as sub:
            events = [(ev.kind, ev.payload) async for ev in sub.iter_history()]

    assert job.status == "failed"
    assert fake.requests == []
    kind, payload = events[-1]
    assert kind == "failed"
    assert payload["failure"]["kind"] == FailureKind.ERROR


async def test_a_second_audit_reuses_cached_verdicts(
    tmp_path: Path, sqlite_engine: object
) -> None:
    repo = JobRepository(async_sessionmaker(sqlite_engine, expire_on_commit=False))
    first_fake, second_fake = FakeLLM(), FakeLLM()
    await _audit(tmp_path, first_fake, cheap_llm=True, repo=repo, cache_enabled=True)
    job, _ = await _audit(tmp_path, second_fake, cheap_llm=True, repo=repo, cache_enabled=True)

    cached = [f for f in job.findings if f.from_cache]
    assert cached
    evidence_ids = {e.id for e in job.evidences}
    assert all(f.evidence_ids and set(f.evidence_ids) <= evidence_ids for f in cached)
    first, second = llm_calls(first_fake), llm_calls(second_fake)
    assert second["responses:verifier"] == first["responses:verifier"] - len(cached)
