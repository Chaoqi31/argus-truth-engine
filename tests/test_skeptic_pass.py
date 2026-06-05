"""Skeptic pass reviews high-risk verifier findings before final scoring."""
from __future__ import annotations

import json
from pathlib import Path

from argus.config import Settings
from argus.models.domain import FindingVerdict
from argus.orchestrator import audit_pdf
from tests._helpers.mock_miromind import StreamRouter, completed, msg

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"


def _planner_json() -> str:
    return json.dumps(
        {
            "claims": [
                {
                    "id": "c1",
                    "text": "Smith (2021) proved the widget theorem.",
                    "page": 1,
                    "span": [0, 40],
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
            "confidence": 0.6,
            "summary": "No exact title match was found.",
            "why_wrong": "The cited paper could not be located.",
            "correct_information": None,
            "evidence": [
                {
                    "source_type": "crossref",
                    "url": "https://api.crossref.org/works?query=smith-widget",
                    "snippet": "No matching title.",
                },
                {
                    "source_type": "web_page",
                    "url": "https://scholar.example/search?q=smith-widget",
                    "snippet": "No exact match.",
                },
            ],
            "reasoning_chain": [
                {
                    "action": "Searched exact title",
                    "observation": "No exact match.",
                    "reasoning": "The citation appears fabricated.",
                }
            ],
        }
    )


def _skeptic_counterevidence_json() -> str:
    return json.dumps(
        {
            "status": "counterevidence_found",
            "summary": "A credible title variant exists under the same author and year.",
            "recommended_verdict": "uncertain",
            "counterevidence": [
                {
                    "source": "Publisher archive",
                    "url": "https://publisher.example/smith-widget-theorem",
                    "snippet": "Smith, 2021, Widget Theorem and Applications.",
                    "relevance": "The title differs slightly but may be the cited work.",
                }
            ],
        }
    )


def _reporter_json() -> str:
    return json.dumps(
        {"executive_summary_md": "**1 issue**.", "ranked_finding_ids": []}
    )


async def test_skeptic_counterevidence_downgrades_high_risk_verdict(
    tmp_path: Path,
) -> None:
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add("unified_verifier", [msg(_verifier_json()), completed(tokens=60)])
    router.add("skeptic", [msg(_skeptic_counterevidence_json()), completed(tokens=40)])
    router.add("consistency", [msg(json.dumps({"contradictions": []})), completed(tokens=20)])
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=tmp_path / "findings.json",
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
    )

    finding = next(f for f in job.findings if f.agent == "UnifiedVerifier")
    assert finding.skeptic_review is not None
    assert finding.skeptic_review.status == "counterevidence_found"
    assert finding.verdict == FindingVerdict.UNCERTAIN
    assert finding.confidence <= 0.5
    assert "skeptic counterevidence found" in finding.flags

    skeptic_traces = [t for t in job.traces if t.agent == "Skeptic"]
    assert len(skeptic_traces) == 1

    stage_by_key = {stage.key: stage for stage in job.stages}
    assert stage_by_key["skeptic"].summary == (
        "Challenged 1 high-risk finding(s) · 1 counterevidence found"
    )
    assert stage_by_key["skeptic"].metrics == {
        "n_reviewed": 1,
        "n_cleared": 0,
        "n_counterevidence_found": 1,
        "n_inconclusive": 0,
    }


def _verifier_json_high_confidence() -> str:
    return json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.95,
            "summary": "No exact title match was found.",
            "why_wrong": "The cited paper could not be located.",
            "correct_information": None,
            "evidence": [
                {
                    "source_type": "crossref",
                    "url": "https://api.crossref.org/works?query=smith-widget",
                    "snippet": "No matching title.",
                },
                {
                    "source_type": "web_page",
                    "url": "https://scholar.example/search?q=smith-widget",
                    "snippet": "No exact match.",
                },
            ],
            "reasoning_chain": [
                {
                    "action": "Searched exact title",
                    "observation": "No exact match.",
                    "reasoning": "The citation appears fabricated.",
                }
            ],
        }
    )


async def test_skeptic_skips_high_confidence_high_risk_verdict(
    tmp_path: Path,
) -> None:
    # A high-risk verdict the verifier is confident about (>= threshold) is NOT
    # re-challenged — skeptic only spends a MiroMind call on low-confidence
    # high-risk findings. No "skeptic" route is registered, so a regression that
    # wrongly triggers the pass fails loudly on a missing mock route.
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "unified_verifier",
        [msg(_verifier_json_high_confidence()), completed(tokens=60)],
    )
    router.add("consistency", [msg(json.dumps({"contradictions": []})), completed(tokens=20)])
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=tmp_path / "findings.json",
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
    )

    finding = next(f for f in job.findings if f.agent == "UnifiedVerifier")
    assert finding.skeptic_review is None
    assert finding.verdict == FindingVerdict.FABRICATED
    assert [t for t in job.traces if t.agent == "Skeptic"] == []
