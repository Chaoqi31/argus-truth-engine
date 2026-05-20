"""Orchestrator publishes lifecycle + step + finding events to the TraceBus."""
from __future__ import annotations

import json
from pathlib import Path

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
