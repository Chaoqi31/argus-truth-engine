"""Tests for the Consistency Checker agent's prompt + output model."""
from __future__ import annotations

from argus.agents.consistency import (
    ConsistencyOutput,
    ContradictionPair,
    build_consistency_input,
)
from argus.models.domain import Claim, ClaimType, Severity


def test_consistency_output_with_pairs() -> None:
    payload = {
        "contradictions": [
            {
                "claim_a_id": "c1",
                "claim_b_id": "c5",
                "severity": "major",
                "confidence": 0.9,
                "summary": "Margin reported as 32% on page 3 but 28% on page 17.",
            }
        ]
    }
    out = ConsistencyOutput.model_validate(payload)
    assert len(out.contradictions) == 1
    pair = out.contradictions[0]
    assert isinstance(pair, ContradictionPair)
    assert pair.severity == Severity.MAJOR


def test_consistency_output_empty() -> None:
    out = ConsistencyOutput.model_validate({"contradictions": []})
    assert out.contradictions == []


def test_consistency_input_enumerates_claims() -> None:
    claims = [
        Claim(
            id="c1",
            text="Margin is 32%.",
            page=3,
            span=(0, 14),
            type=ClaimType.NUMERICAL_DATA,
            importance="high",
            extracted_metadata={"indicator": "margin", "value": 32.0},
        ),
        Claim(
            id="c2",
            text="Margin is 28%.",
            page=17,
            span=(0, 14),
            type=ClaimType.NUMERICAL_DATA,
            importance="high",
            extracted_metadata={"indicator": "margin", "value": 28.0},
        ),
    ]
    text = build_consistency_input(claims)
    assert "c1" in text and "c2" in text
    assert "32" in text and "28" in text
    assert "execute_python" in text or "Python" in text
