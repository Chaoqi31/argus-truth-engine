"""Golden pin for the whole audit pipeline, driven through the real HTTP clients.

The fake LLM server answers from a fixed scenario, so the audit is
deterministic. The snapshot covers the final Job, the events that built it,
and how many calls each LLM task received.
"""

from __future__ import annotations

import pytest

from argus.audit import Run, extract, verify
from argus.llm import Transports
from argus.llm.miromind import MiroMindAccess
from argus.models.domain import ContentDomain, new_id
from argus.models.job import EventFrame, Job
from tests.fake_llm import AUDIT_TEXT, FakeLLM
from tests.golden import (
    assert_golden,
    audit_settings,
    fake_llm_server,
    record_run,
    replayed,
    snapshot,
)


async def _run(*, cheap_llm: bool) -> tuple[Job, Job, list[EventFrame], FakeLLM]:
    """The initial job, the audited job, its frames, and the fake it talked to."""
    job = Job(
        id=new_id("job"),
        input_text=AUDIT_TEXT,
        input_mode="text",
        content_domain=ContentDomain.FINANCE,
    )
    initial = job.model_copy(deep=True)
    frames: list[EventFrame] = []
    with fake_llm_server() as (base_url, fake):
        settings = audit_settings(base_url, cheap_llm=cheap_llm)
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
            assert job.status == "awaiting_review"
            await verify(run, [c.id for c in job.claims])
    return initial, job, frames, fake


@pytest.mark.parametrize(
    ("name", "cheap_llm"),
    [("text_with_cheap_llm", True), ("text_miromind_only", False)],
)
async def test_pipeline_matches_golden(name: str, cheap_llm: bool) -> None:
    initial, job, frames, fake = await _run(cheap_llm=cheap_llm)
    assert job.status == "done"
    assert_golden(
        name,
        snapshot(job.model_dump(mode="json"), [f.model_dump(mode="json") for f in frames], fake),
    )
    record_run(name, initial, frames, job)


async def test_the_events_rebuild_the_job() -> None:
    initial, job, frames, _ = await _run(cheap_llm=True)

    assert [f.version for f in frames] == list(range(1, job.version + 1))
    assert replayed(initial, frames) == job


async def test_pipeline_references_resolve() -> None:
    _, job, _, _ = await _run(cheap_llm=True)
    evidence_ids = {e.id for e in job.evidences}
    trace_ids = {t.id for t in job.traces}
    claim_ids = {c.id for c in job.claims}
    step_ids = {s.id for t in job.traces for s in t.steps}
    for finding in job.findings:
        assert finding.claim_id in claim_ids
        assert finding.reasoning_trace_id in trace_ids
        assert set(finding.evidence_ids) <= evidence_ids
    assert {e.retrieved_by_step_id for e in job.evidences} <= step_ids
    assert all(t.completed_at is not None for t in job.traces)
