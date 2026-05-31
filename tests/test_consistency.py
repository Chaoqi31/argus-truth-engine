"""Tests for the Consistency Checker agent's prompt + output model."""
from __future__ import annotations

from argus.agents.consistency import (
    ConsistencyOutput,
    ContradictionPair,
    LogicalFlaw,
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
    assert out.logical_flaws == []


def test_consistency_output_with_logical_flaws() -> None:
    payload = {
        "contradictions": [],
        "logical_flaws": [
            {
                "claim_id": "c7",
                "type": "unsupported_inference",
                "severity": "major",
                "confidence": 0.8,
                "summary": "Concludes the merger will boost margins, but the "
                "only cited support is a single unverified analyst note.",
                "missing": "Independent margin guidance or post-merger "
                "financials confirming the projected uplift.",
            },
            {
                "claim_id": "c9",
                "type": "overreach",
                "severity": "minor",
                "confidence": 0.65,
                "summary": "States the product is the market leader, but the "
                "cited survey only covers one region.",
                "missing": "Global market-share data supporting the leadership "
                "claim beyond the single surveyed region.",
            },
        ],
    }
    out = ConsistencyOutput.model_validate(payload)
    assert out.contradictions == []
    assert len(out.logical_flaws) == 2
    first = out.logical_flaws[0]
    assert isinstance(first, LogicalFlaw)
    assert first.claim_id == "c7"
    assert first.type == "unsupported_inference"
    assert first.severity == Severity.MAJOR
    assert first.confidence == 0.8
    assert first.missing.startswith("Independent margin guidance")
    assert out.logical_flaws[1].type == "overreach"


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
    assert "fact table" in text
