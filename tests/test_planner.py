"""Tests for the Planner agent's prompt + output model only.

End-to-end MiroMind calls are exercised by tests/test_orchestrator_e2e.py.
"""
from __future__ import annotations

from argus.agents.planner import PlannerOutput, build_planner_input
from argus.models.domain import ClaimType
from argus.pdf.parser import ParsedDoc, ParsedPage


def test_planner_output_validates_claim_types() -> None:
    payload = {
        "claims": [
            {
                "id": "c1",
                "text": "Smith (2021) found X.",
                "page": 1,
                "span": [0, 22],
                "type": "citation",
                "importance": "high",
                "extracted_metadata": {"authors": ["Smith"], "year": 2021},
            }
        ]
    }
    out = PlannerOutput.model_validate(payload)
    assert out.claims[0].type == ClaimType.CITATION


def test_planner_output_coerces_empty_enums_to_safe_defaults() -> None:
    """MiroMind occasionally emits empty strings for type/importance.

    The audit should still proceed; only the planner's labels are downgraded.
    """
    payload = {
        "claims": [
            {
                "id": "c4",
                "text": "...",
                "page": 1,
                "span": [0, 3],
                "type": "",                 # empty enum
                "importance": "",           # empty enum
                "extracted_metadata": {},
            },
            {
                "id": "c5",
                "text": "...",
                "page": 1,
                "span": [0, 3],
                "type": "not-a-real-type",  # unknown enum
                "importance": "URGENT",     # unknown enum
                "extracted_metadata": {},
            },
        ]
    }
    out = PlannerOutput.model_validate(payload)
    assert len(out.claims) == 2  # noqa: PLR2004
    assert out.claims[0].type == ClaimType.QUALITATIVE
    assert out.claims[0].importance == "low"
    assert out.claims[1].type == ClaimType.QUALITATIVE
    assert out.claims[1].importance == "low"


def test_build_planner_input_contains_page_markers() -> None:
    doc = ParsedDoc(
        source_path=None,  # type: ignore[arg-type]
        pages=(
            ParsedPage(page_number=1, text="hello", start_offset=0),
            ParsedPage(page_number=2, text="world", start_offset=6),
        ),
        full_text="hello\nworld",
    )
    text = build_planner_input(doc)
    assert "[PAGE 1]" in text
    assert "[PAGE 2]" in text
    assert "hello" in text and "world" in text
