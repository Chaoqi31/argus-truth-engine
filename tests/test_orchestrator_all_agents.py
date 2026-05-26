"""Plan B1 5-agent e2e (3 mixed claims), migrated to LangGraph + StreamRouter."""
from __future__ import annotations

import json
from pathlib import Path

from argus.config import Settings
from argus.models.domain import StepType
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
                    "text": "US Q2 2025 GDP growth was 2.1%.",
                    "page": 2,
                    "span": [0, 32],
                    "type": "numerical-data",
                    "importance": "high",
                    "extracted_metadata": {"indicator": "GDP growth", "value": 2.1},
                },
                {
                    "id": "c3",
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
                {
                    "source_type": "crossref",
                    "url": "https://api.crossref.org/x",
                    "snippet": "{}",
                }
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


def _verifier_stale() -> str:
    return json.dumps(
        {
            "verdict": "stale",
            "confidence": 0.9,
            "summary": "Q3 release supersedes.",
            "why_wrong": "GDP figure has been revised upward in Q3 release.",
            "correct_information": {
                "value": "2.4%",
                "source": "FRED UNRATE series Q3 2025",
            },
            "evidence": [
                {
                    "source_type": "fred",
                    "url": "https://api.stlouisfed.org/",
                    "snippet": "2.4",
                }
            ],
            "reasoning_chain": [
                {
                    "action": "fetch_fred",
                    "observation": "Current value is 2.4%",
                    "reasoning": "Claim is stale.",
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
                {
                    "source_type": "sec_edgar",
                    "url": "https://data.sec.gov/x",
                    "snippet": "",
                }
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


async def test_full_5_agent_pipeline(tmp_path: Path) -> None:
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=120)])
    # c1 (citation) → unified_verifier
    router.add(
        "unified_verifier",
        [
            tool("web_search", {"q": "Smith"}, 2),
            msg(_verifier_fabricated()),
            completed(tokens=80),
        ],
    )
    # c2 (numerical-data) → unified_verifier
    router.add(
        "unified_verifier",
        [
            tool("fetch_url_content", {"url": "fred"}, 2),
            msg(_verifier_stale()),
            completed(tokens=90),
        ],
    )
    # c3 (numerical-data) → unified_verifier
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
            msg(
                json.dumps(
                    {
                        "contradictions": [
                            {
                                "claim_a_id": "c2",
                                "claim_b_id": "c3",
                                "severity": "minor",
                                "confidence": 0.55,
                                "summary": "Minor tension between metrics.",
                            }
                        ]
                    }
                )
            ),
            completed(tokens=110),
        ],
    )
    router.add(
        "reporter",
        [
            msg(
                json.dumps(
                    {
                        "executive_summary_md": "**3 issues** detected.",
                        "ranked_finding_ids": [],
                    }
                )
            ),
            completed(tokens=40),
        ],
    )

    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
    )

    assert len(job.claims) == 3
    # 3 unified_verifier findings (c1, c2, c3) + 2 paired consistency findings = 5
    assert len(job.findings) == 5
    by_agent = {f.agent for f in job.findings}
    assert by_agent == {"UnifiedVerifier", "Consistency"}

    assert job.audit_report_md is not None
    assert "3 issues" in job.audit_report_md

    consistency_findings = [f for f in job.findings if f.agent == "Consistency"]
    assert len(consistency_findings) == 2
    f_a, f_b = consistency_findings
    assert f_a.id in f_b.related_finding_ids
    assert f_b.id in f_a.related_finding_ids

    step_types = {s.type for t in job.traces for s in t.steps}
    assert StepType.WEB_SEARCH in step_types
    assert StepType.FETCH_URL_CONTENT in step_types

    saved = json.loads(out.read_text())
    assert saved["id"] == job.id
    assert saved["audit_report_md"] is not None
