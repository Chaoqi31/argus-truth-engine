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


async def test_full_5_agent_pipeline(tmp_path: Path) -> None:
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=120)])
    router.add(
        "citation_verifier",
        [
            tool("web_search", {"q": "Smith"}, 2),
            msg(
                json.dumps(
                    {
                        "verdict": "fabricated",
                        "confidence": 0.92,
                        "summary": "No record.",
                        "evidence": [
                            {
                                "source_type": "crossref",
                                "url": "https://api.crossref.org/x",
                                "snippet": "{}",
                            }
                        ],
                    }
                )
            ),
            completed(tokens=80),
        ],
    )
    router.add(
        "citation_alignment",
        [
            tool("fetch_url_content", {"url": "x"}, 2),
            msg(
                json.dumps(
                    {
                        "verdict": "uncertain",
                        "confidence": 0.4,
                        "summary": "Source not retrievable.",
                        "evidence": [
                            {"source_type": "web_page", "url": None, "snippet": "404"}
                        ],
                    }
                )
            ),
            completed(tokens=70),
        ],
    )
    router.add(
        "data_freshness",
        [
            tool("fetch_url_content", {"url": "fred"}, 2),
            msg(
                json.dumps(
                    {
                        "verdict": "stale",
                        "confidence": 0.9,
                        "summary": "Q3 release supersedes.",
                        "as_of_date": "Q2 2025",
                        "current_value": "2.4%",
                        "evidence": [
                            {
                                "source_type": "fred",
                                "url": "https://api.stlouisfed.org/",
                                "snippet": "2.4",
                            }
                        ],
                    }
                )
            ),
            completed(tokens=90),
        ],
    )
    router.add(
        "data_freshness",
        [
            tool("fetch_url_content", {"url": "sec"}, 2),
            msg(
                json.dumps(
                    {
                        "verdict": "ok",
                        "confidence": 0.7,
                        "summary": "Matches latest filing.",
                        "as_of_date": None,
                        "current_value": "32%",
                        "evidence": [
                            {
                                "source_type": "sec_edgar",
                                "url": "https://data.sec.gov/x",
                                "snippet": "",
                            }
                        ],
                    }
                )
            ),
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
    # 1 verifier (c1) + 1 alignment (c1) + 2 freshness (c2, c3)
    # + 2 paired consistency findings = 6
    assert len(job.findings) == 6
    by_agent = {f.agent for f in job.findings}
    assert by_agent == {
        "CitationVerifier",
        "CitationAlignment",
        "DataFreshness",
        "Consistency",
    }

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
