"""Tests for the Citation Verifier agent's prompt + output model."""
from __future__ import annotations

from argus.agents.citation_verifier import (
    CitationVerifierOutput,
    build_verifier_input,
)
from argus.models.domain import Claim, ClaimType, FindingVerdict


def test_verifier_output_validates() -> None:
    payload = {
        "verdict": "fabricated",
        "confidence": 0.95,
        "summary": "No DOI found in Crossref or Google Scholar.",
        "evidence": [
            {
                "source_type": "crossref",
                "url": "https://api.crossref.org/works?query=...",
                "snippet": "{}",
            }
        ],
    }
    out = CitationVerifierOutput.model_validate(payload)
    assert out.verdict == FindingVerdict.FABRICATED
    assert out.evidence[0].url is not None


def test_input_includes_claim_text() -> None:
    claim = Claim(
        id="c1",
        text="Smith (2021) showed widgets are resilient.",
        page=1,
        span=(0, 41),
        type=ClaimType.CITATION,
        importance="high",
        extracted_metadata={"authors": ["Smith"], "year": 2021},
    )
    text = build_verifier_input(claim, surrounding="paragraph here")
    assert "Smith (2021)" in text
    assert "paragraph here" in text
