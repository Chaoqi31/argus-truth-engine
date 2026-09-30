"""Golden pin for the whole audit pipeline, driven through the real HTTP clients.

The fake LLM server answers from a fixed scenario, so the audit is
deterministic. The snapshot covers the final Job, the event stream, and how
many calls each LLM task received.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from argus.models.domain import Job
from argus.orchestrator import audit_text
from argus.trace_bus.in_process import InProcessBus
from tests.fake_llm import AUDIT_TEXT, FakeLLM
from tests.golden import assert_golden, audit_settings, fake_llm_server, snapshot


async def _history(bus: InProcessBus, job_id: str) -> list[dict[str, Any]]:
    async with bus.subscribe(job_id) as sub:
        return [
            {"job_id": ev.job_id, "sequence": ev.sequence, "kind": ev.kind, "payload": ev.payload}
            async for ev in sub.iter_history()
        ]


async def _run(tmp_path: Path, *, cheap_llm: bool) -> tuple[Job, list[dict[str, Any]], FakeLLM]:
    with fake_llm_server() as (base_url, fake):
        bus = InProcessBus()
        job = await audit_text(
            text=AUDIT_TEXT,
            output_path=tmp_path / "findings.json",
            settings=audit_settings(base_url, cheap_llm=cheap_llm),
            budget_usd=50.0,
            trace_bus=bus,
            auto_review=True,
            content_domain="finance",
        )
        return job, await _history(bus, job.id), fake


@pytest.mark.parametrize(
    ("name", "cheap_llm"),
    [("text_with_cheap_llm", True), ("text_miromind_only", False)],
)
async def test_pipeline_matches_golden(tmp_path: Path, name: str, cheap_llm: bool) -> None:
    job, events, fake = await _run(tmp_path, cheap_llm=cheap_llm)
    assert_golden(name, snapshot(job.model_dump(mode="json"), events, fake))


async def test_pipeline_references_resolve(tmp_path: Path) -> None:
    job, _, _ = await _run(tmp_path, cheap_llm=True)
    evidence_ids = {e.id for e in job.evidences}
    trace_ids = {t.id for t in job.traces}
    claim_ids = {c.id for c in job.claims}
    for finding in job.findings:
        assert finding.claim_id in claim_ids
        assert finding.reasoning_trace_id in trace_ids
        assert set(finding.evidence_ids) <= evidence_ids
