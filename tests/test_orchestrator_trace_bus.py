"""Orchestrator publishes lifecycle + step + finding events to the TraceBus."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock

from argus.config import Settings
from argus.orchestrator import audit_pdf
from argus.trace_bus.in_process import InProcessBus
from tests._helpers.mock_miromind import StreamRouter, completed, msg, tool

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"


def _planner_json() -> str:
    return json.dumps(
        {
            "claims": [
                {
                    "id": "c1",
                    "text": "Smith (2021) X.",
                    "page": 1,
                    "span": [0, 16],
                    "type": "citation",
                    "importance": "high",
                    "extracted_metadata": {"authors": ["Smith"], "year": 2021},
                }
            ]
        }
    )


def _verifier_json() -> str:
    return json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.9,
            "summary": "No record.",
            "evidence": [
                {"source_type": "crossref", "url": "https://api.crossref.org/x", "snippet": "{}"}
            ],
        }
    )


def _alignment_json() -> str:
    return json.dumps(
        {
            "verdict": "uncertain",
            "confidence": 0.4,
            "summary": "Source not retrievable.",
            "evidence": [{"source_type": "web_page", "url": None, "snippet": "404"}],
        }
    )


def _reporter_json() -> str:
    return json.dumps(
        {"executive_summary_md": "**1 issue**.", "ranked_finding_ids": []}
    )


async def test_audit_pdf_publishes_lifecycle_and_step_events(tmp_path: Path) -> None:
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "citation_verifier",
        [tool("web_search", {"q": "Smith"}, 2), msg(_verifier_json()), completed(tokens=60)],
    )
    router.add(
        "citation_alignment",
        [msg(_alignment_json()), completed(tokens=40)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
        trace_bus=bus,
    )

    # After audit_pdf returns, subscribe and replay history.
    async with bus.subscribe(job.id) as sub:
        history = [ev async for ev in sub.iter_history()]

    kinds = [ev.kind for ev in history]
    assert kinds[0] == "started"
    assert kinds[-1] == "finished"
    assert "step" in kinds
    assert "finding" in kinds

    # Sequence numbers strictly increasing, starting at 1.
    seqs = [ev.sequence for ev in history]
    assert seqs == sorted(seqs)
    assert seqs[0] == 1
    assert len(set(seqs)) == len(seqs)

    # Every event belongs to the right job.
    assert all(ev.job_id == job.id for ev in history)


async def test_audit_pdf_honours_caller_supplied_job_id(tmp_path: Path) -> None:
    """Regression: HTTP API needs submit-time id == orchestrator event job_id.

    Without this, the WebSocket subscriber (which sees the POST /jobs job_id)
    finds zero events because the orchestrator publishes under its own
    auto-generated id.
    """
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "citation_verifier",
        [msg(_verifier_json()), completed(tokens=60)],
    )
    router.add(
        "citation_alignment",
        [msg(_alignment_json()), completed(tokens=40)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
        trace_bus=bus,
        job_id="job_caller_supplied",
    )
    assert job.id == "job_caller_supplied"

    async with bus.subscribe("job_caller_supplied") as sub:
        history = [ev async for ev in sub.iter_history()]
    assert len(history) >= 2  # at least started + finished  # noqa: PLR2004
    assert all(ev.job_id == "job_caller_supplied" for ev in history)


async def test_audit_pdf_traps_unexpected_exception_and_publishes_failed(
    tmp_path: Path,
) -> None:
    """Regression: a runtime error mid-graph must still emit a 'failed' WS event.

    Live MiroMind runs occasionally produce httpx errors that bubble out of an
    agent node after retries exhaust. Without this trap, audit_pdf raised, the
    JobRunner only marked an internal failure, and WS subscribers hung waiting
    for a terminal event that never came.
    """
    # Force the orchestrator into the unhandled-exception branch by making the
    # MiroMind client raise on its very first call (mirrors a real httpx
    # connection error that survives the retry layer).
    fake_client = AsyncMock()
    fake_client.submit_background = AsyncMock(
        side_effect=RuntimeError("upstream peer closed"),
    )

    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=fake_client,
        budget_usd=10.0,
        trace_bus=bus,
        job_id="job_exc_test",
    )
    assert job.status == "failed"
    assert job.id == "job_exc_test"

    async with bus.subscribe("job_exc_test") as sub:
        history = [ev async for ev in sub.iter_history()]
    kinds = [ev.kind for ev in history]
    assert kinds[0] == "started"
    assert kinds[-1] == "failed"
    assert "RuntimeError" in (history[-1].payload.get("reason") or "")


async def test_audit_pdf_no_bus_is_no_op(tmp_path: Path) -> None:
    """Omitting trace_bus must not raise; existing callers are unaffected."""
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "citation_verifier",
        [msg(_verifier_json()), completed(tokens=60)],
    )
    router.add(
        "citation_alignment",
        [msg(_alignment_json()), completed(tokens=40)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
    )
    assert job.id
