"""Tests for the Citation Alignment agent's prompt + output model."""
from __future__ import annotations

from argus.agents.citation_alignment import (
    CitationAlignmentOutput,
    build_alignment_input,
)
from argus.models.domain import Claim, ClaimType, FindingVerdict


def test_alignment_output_accepts_known_verdicts() -> None:
    for verdict in ("ok", "partial-match", "mismatch", "misrepresented", "uncertain"):
        out = CitationAlignmentOutput.model_validate(
            {
                "verdict": verdict,
                "confidence": 0.8,
                "summary": "ok",
                "evidence": [],
            }
        )
        assert out.verdict == FindingVerdict(verdict)


def test_alignment_input_quotes_claim_and_source_hint() -> None:
    claim = Claim(
        id="c1",
        text="Smith (2021) showed widgets are resilient.",
        page=1,
        span=(0, 41),
        type=ClaimType.CITATION,
        importance="high",
        extracted_metadata={
            "authors": ["Smith"],
            "year": 2021,
            "doi": "10.1234/widget",
            "title": "On widget resilience",
        },
    )
    text = build_alignment_input(claim, surrounding="paragraph here")
    assert "Smith (2021)" in text
    assert "10.1234/widget" in text
    assert "paragraph here" in text
