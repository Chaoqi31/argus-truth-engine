"""Plan A e2e (2 citation claims), migrated to LangGraph + StreamRouter."""
from __future__ import annotations

import json
from pathlib import Path

from argus.config import Settings
from argus.models.domain import ClaimType, StepType
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
                    "span": [0, 21],
                    "type": "citation",
                    "importance": "high",
                    "extracted_metadata": {"authors": ["Smith"], "year": 2021},
                },
                {
                    "id": "c2",
                    "text": "Doe et al. (2019) studied Y.",
                    "page": 1,
                    "span": [22, 50],
                    "type": "citation",
                    "importance": "medium",
                    "extracted_metadata": {"authors": ["Doe"], "year": 2019},
                },
            ]
        }
    )


def _verifier_fab() -> str:
    return json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.9,
            "summary": "No DOI found.",
            "why_wrong": "Paper does not exist in Crossref or arXiv.",
            "correct_information": None,
            "evidence": [
                {
                    "source_type": "crossref",
                    "url": "https://api.crossref.org/works?query=Smith",
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


def _verifier_ok() -> str:
    return json.dumps(
        {
            "verdict": "ok",
            "confidence": 0.85,
            "summary": "Found in Crossref.",
            "why_wrong": None,
            "correct_information": None,
            "evidence": [
                {"source_type": "crossref", "url": "https://doi.org/10.1234/x", "snippet": "{}"}
            ],
            "reasoning_chain": [
                {
                    "action": "search_crossref",
                    "observation": "1 result matching DOI",
                    "reasoning": "Citation verified.",
                }
            ],
        }
    )


def _consistency_empty() -> str:
    return json.dumps({"contradictions": []})


def _reporter() -> str:
    return json.dumps(
        {"executive_summary_md": "Audit complete.", "ranked_finding_ids": []}
    )


async def test_orchestrator_emits_findings_for_each_citation(tmp_path: Path) -> None:
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=120)])
    # Two UnifiedVerifier calls — first fabricated, second OK
    router.add(
        "unified_verifier",
        [tool("web_search", {"q": "Smith"}, 2), msg(_verifier_fab()), completed(tokens=80)],
    )
    router.add(
        "unified_verifier",
        [tool("fetch_url_content", {"url": "y"}, 2), msg(_verifier_ok()), completed(tokens=80)],
    )
    # Consistency runs (>=2 claims overall).
    router.add(
        "consistency",
        [msg(_consistency_empty()), completed(tokens=30)],
    )
    router.add("reporter", [msg(_reporter()), completed(tokens=20)])

    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
    )

    assert len(job.claims) == 2
    assert all(c.type == ClaimType.CITATION for c in job.claims)
    # Each citation produces one UnifiedVerifier finding (no Alignment finding).
    assert len(job.findings) == 2
    by_agent = {f.agent for f in job.findings}
    assert by_agent == {"UnifiedVerifier"}

    verifier_verdicts = sorted(
        f.verdict for f in job.findings if f.agent == "UnifiedVerifier"
    )
    # Check we got 2 verifier findings
    assert len(verifier_verdicts) == 2
    assert any(s.type == StepType.WEB_SEARCH for t in job.traces for s in t.steps)
    assert out.exists()
    saved = json.loads(out.read_text())
    assert saved["id"] == job.id
