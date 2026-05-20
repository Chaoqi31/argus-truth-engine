"""Tests for the Reporter agent's prompt + output model."""
from __future__ import annotations

from argus.agents.reporter import (
    ReporterOutput,
    build_reporter_input,
)
from argus.models.domain import Claim, ClaimType, Finding, FindingVerdict, Severity


def _claim(cid: str) -> Claim:
    return Claim(
        id=cid,
        text=f"text-{cid}",
        page=1,
        span=(0, 5),
        type=ClaimType.CITATION,
        importance="high",
        extracted_metadata={},
    )


def _finding(fid: str, claim_id: str, severity: Severity, confidence: float) -> Finding:
    return Finding(
        id=fid,
        job_id="j1",
        claim_id=claim_id,
        agent="CitationVerifier",
        verdict=FindingVerdict.FABRICATED,
        severity=severity,
        confidence=confidence,
        summary=f"summary {fid}",
        evidence_ids=[],
        reasoning_trace_id="t1",
    )


def test_reporter_output_validates() -> None:
    out = ReporterOutput.model_validate(
        {
            "executive_summary_md": "**3 issues** found.\n\n- f1: critical\n- f2: major",
            "ranked_finding_ids": ["f1", "f2"],
        }
    )
    assert out.ranked_finding_ids == ["f1", "f2"]
    assert out.executive_summary_md.startswith("**3 issues**")


def test_reporter_input_serialises_findings_and_claims() -> None:
    claims = [_claim("c1"), _claim("c2")]
    findings = [
        _finding("f1", "c1", Severity.CRITICAL, 0.95),
        _finding("f2", "c2", Severity.MINOR, 0.6),
    ]
    text = build_reporter_input(claims, findings)
    assert "f1" in text and "f2" in text
    assert "critical" in text and "minor" in text
