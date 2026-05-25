"""End-to-end test of the LangGraph orchestrator with the shared StreamRouter."""
from __future__ import annotations

import json
from pathlib import Path

from argus.config import Settings
from argus.orchestrator import audit_pdf
from tests._helpers.mock_miromind import StreamRouter, completed, msg, tool

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"


def _planner_json() -> str:
    return json.dumps(
        {
            "claims": [
                {
                    "id": "c1",
                    "text": "Smith (2021) showed X.",
                    "page": 1,
                    "span": [0, 22],
                    "type": "citation",
                    "importance": "high",
                    "extracted_metadata": {"authors": ["Smith"], "year": 2021},
                },
                {
                    "id": "c2",
                    "text": "Margin is 32%.",
                    "page": 3,
                    "span": [0, 14],
                    "type": "numerical-data",
                    "importance": "high",
                    "extracted_metadata": {"indicator": "margin", "value": 32.0},
                },
            ]
        }
    )


def _verifier_json() -> str:
    return json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.92,
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


def _freshness_json() -> str:
    return json.dumps(
        {
            "verdict": "ok",
            "confidence": 0.7,
            "summary": "Matches latest filing.",
            "as_of_date": None,
            "current_value": "32%",
            "evidence": [
                {"source_type": "sec_edgar", "url": "https://data.sec.gov/x", "snippet": ""}
            ],
        }
    )


def _consistency_json() -> str:
    return json.dumps({"contradictions": []})


def _reporter_json() -> str:
    return json.dumps(
        {
            "executive_summary_md": "**1 issue** found.",
            "ranked_finding_ids": [],
        }
    )


def _build_router_for_two_claims() -> StreamRouter:
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=120)])
    router.add(
        "citation_verifier",
        [tool("web_search", {"q": "Smith"}, 2), msg(_verifier_json()), completed(tokens=80)],
    )
    router.add(
        "citation_alignment",
        [tool("fetch_url_content", {"url": "x"}, 2), msg(_alignment_json()), completed(tokens=70)],
    )
    router.add(
        "data_freshness",
        [
            tool("fetch_url_content", {"url": "sec"}, 2),
            msg(_freshness_json()),
            completed(tokens=60),
        ],
    )
    router.add(
        "consistency",
        [
            tool("execute_python", {"code": "..."}, 2),
            msg(_consistency_json()),
            completed(tokens=90),
        ],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=40)])
    return router


async def test_langgraph_runs_all_five_agents_with_parallel_fan_in(tmp_path: Path) -> None:
    router = _build_router_for_two_claims()
    client = router.make_client()
    out = tmp_path / "findings.json"

    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=client,
        budget_usd=10.0,
    )

    # 1 verifier + 1 alignment + 1 freshness + 0 consistency (empty) = 3 findings
    assert len(job.findings) == 3
    by_agent = {f.agent for f in job.findings}
    assert by_agent == {"CitationVerifier", "CitationAlignment", "DataFreshness"}

    # Reporter ran exactly once after the fan-in
    assert job.audit_report_md == "**1 issue** found."

    # Each specialist was invoked exactly once
    assert len(router.calls_for("citation_verifier")) == 1
    assert len(router.calls_for("citation_alignment")) == 1
    assert len(router.calls_for("data_freshness")) == 1
    assert len(router.calls_for("consistency")) == 1
    assert len(router.calls_for("reporter")) == 1

    # Final file written
    saved = json.loads(out.read_text())
    assert saved["id"] == job.id
    assert saved["audit_report_md"] is not None


async def test_langgraph_aborts_on_budget_breach(tmp_path: Path) -> None:
    """Budget breach during planner aborts the run before specialists fire."""
    router = StreamRouter()
    # Planner returns a huge token count to force a breach.
    router.add(
        "planner",
        [msg(_planner_json()), completed(tokens=10_000_000_000)],
    )
    client = router.make_client()
    out = tmp_path / "findings.json"

    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=client,
        budget_usd=0.50,
    )

    # No specialists ran.
    assert router.calls_for("citation_verifier") == []
    assert router.calls_for("reporter") == []
    # Job is marked failed.
    assert job.status == "failed"


async def test_langgraph_specialists_are_independent(tmp_path: Path) -> None:
    """A failed specialist must not block the others or the Reporter."""
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=120)])
    # Verifier returns invalid JSON twice — JsonRepairFailed.
    router.add("citation_verifier", [msg("not json"), completed(tokens=10)])
    router.add("citation_verifier", [msg("still not json"), completed(tokens=10)])
    # Others succeed.
    router.add(
        "citation_alignment",
        [msg(_alignment_json()), completed(tokens=20)],
    )
    router.add("data_freshness", [msg(_freshness_json()), completed(tokens=20)])
    router.add("consistency", [msg(_consistency_json()), completed(tokens=20)])
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    client = router.make_client()
    out = tmp_path / "findings.json"

    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=client,
        budget_usd=10.0,
    )

    # 0 verifier (it failed) + 1 alignment + 1 freshness = 2 findings.
    agents = {f.agent for f in job.findings}
    assert "CitationVerifier" not in agents
    assert "CitationAlignment" in agents
    assert "DataFreshness" in agents
    # Reporter still ran.
    assert job.audit_report_md is not None
