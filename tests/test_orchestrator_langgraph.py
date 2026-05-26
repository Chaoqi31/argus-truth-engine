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


def _verifier_fabricated() -> str:
    return json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.92,
            "summary": "No record.",
            "why_wrong": "Paper does not exist in any academic database.",
            "correct_information": None,
            "evidence": [
                {"source_type": "crossref", "url": "https://api.crossref.org/x", "snippet": "{}"}
            ],
            "reasoning_chain": [
                {
                    "action": "search_crossref",
                    "observation": "0 results",
                    "reasoning": "No matching paper found.",
                }
            ],
        }
    )


def _verifier_ok() -> str:
    return json.dumps(
        {
            "verdict": "ok",
            "confidence": 0.7,
            "summary": "Matches latest filing.",
            "why_wrong": None,
            "correct_information": None,
            "evidence": [
                {"source_type": "sec_edgar", "url": "https://data.sec.gov/x", "snippet": ""}
            ],
            "reasoning_chain": [
                {
                    "action": "fetch_sec_edgar",
                    "observation": "32% confirmed in latest 10-K",
                    "reasoning": "Claim verified.",
                }
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
        "unified_verifier",
        [tool("web_search", {"q": "Smith"}, 2), msg(_verifier_fabricated()), completed(tokens=80)],
    )
    router.add(
        "unified_verifier",
        [
            tool("fetch_url_content", {"url": "sec"}, 2),
            msg(_verifier_ok()),
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

    # 2 unified_verifier findings + 0 consistency (empty) = 2 findings
    assert len(job.findings) == 2
    by_agent = {f.agent for f in job.findings}
    assert by_agent == {"UnifiedVerifier"}

    # Reporter ran exactly once after the fan-in
    assert job.audit_report_md == "**1 issue** found."

    # Specialists were invoked
    assert len(router.calls_for("unified_verifier")) == 2
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
    assert router.calls_for("unified_verifier") == []
    assert router.calls_for("reporter") == []
    # Job is marked failed.
    assert job.status == "failed"


async def test_langgraph_specialists_are_independent(tmp_path: Path) -> None:
    """A failed specialist must not block the others or the Reporter."""
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=120)])
    # First verifier call returns invalid JSON — JsonRepairFailed.
    router.add("unified_verifier", [msg("not json"), completed(tokens=10)])
    # Second verifier call succeeds.
    router.add("unified_verifier", [msg(_verifier_ok()), completed(tokens=20)])
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

    # 1 successful verifier finding (the failed one produces no finding)
    assert len(job.findings) >= 1, "at least one finding expected despite partial failure"
    agents = {f.agent for f in job.findings}
    assert "UnifiedVerifier" in agents
    # Reporter still ran.
    assert job.audit_report_md is not None
