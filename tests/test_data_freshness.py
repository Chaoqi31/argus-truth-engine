"""Tests for the Data Freshness agent's prompt + output model."""
from __future__ import annotations

from argus.agents.data_freshness import (
    DataFreshnessOutput,
    build_freshness_input,
)
from argus.models.domain import Claim, ClaimType, FindingVerdict


def test_freshness_output_accepts_known_verdicts() -> None:
    for verdict in ("ok", "stale", "superseded", "uncertain"):
        out = DataFreshnessOutput.model_validate(
            {
                "verdict": verdict,
                "confidence": 0.85,
                "summary": "fresh",
                "evidence": [],
                "as_of_date": None,
                "current_value": None,
            }
        )
        assert out.verdict == FindingVerdict(verdict)


def test_freshness_input_includes_metadata_and_authority_hint() -> None:
    claim = Claim(
        id="c1",
        text="US Q2 2025 GDP growth was 2.1%.",
        page=2,
        span=(0, 32),
        type=ClaimType.NUMERICAL_DATA,
        importance="high",
        extracted_metadata={
            "indicator": "GDP growth",
            "country": "US",
            "value": 2.1,
            "unit": "percent",
            "as_of": "Q2 2025",
        },
    )
    text = build_freshness_input(claim)
    assert "GDP growth" in text
    assert "FRED" in text or "World Bank" in text  # authority hint
    assert "Q2 2025" in text
