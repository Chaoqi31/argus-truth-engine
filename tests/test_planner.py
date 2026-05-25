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
    assert len(out.claims) == 2
    assert out.claims[0].type == ClaimType.QUALITATIVE
    assert out.claims[0].importance == "low"
    assert out.claims[1].type == ClaimType.QUALITATIVE
    assert out.claims[1].importance == "low"


def test_planner_output_tolerates_missing_required_fields() -> None:
    """Regression: a live mini-model run produced claims with missing id/page.

    Before this fix, _RawClaim's strict ``id: str`` and ``page: int = Field(ge=1)``
    failed the whole batch on a single damaged claim. Now missing fields get
    safe defaults; only the genuinely empty (no-text) claims are dropped.
    """
    payload = {
        "claims": [
            # claim 0: missing 'page' entirely (model dropped the value)
            {
                "id": "c1",
                "text": "Smith (2021) found X.",
                "type": "citation",
                "importance": "high",
                "extracted_metadata": {},
            },
            # claim 1: missing 'id' (model emitted ``"":"c2"`` which json-repair
            # collapses to no id), but text + page intact
            {
                "text": "Global widget shipments grew 4.2% YoY in 2024.",
                "page": 2,
                "type": "numerical-data",
                "importance": "high",
                "extracted_metadata": {},
            },
            # claim 2: only id+page survived, text empty → must be dropped
            {
                "id": "c3",
                "text": "",
                "page": 3,
            },
            # claim 3: page is the literal None that json-repair leaves behind
            {
                "id": "c4",
                "text": "Internal contradiction example.",
                "page": None,
                "type": "qualitative",
            },
        ]
    }
    out = PlannerOutput.model_validate(payload)
    claims = out.to_claims()
    assert len(claims) == 3
    # missing 'id' got an auto-generated stable label
    assert claims[1].id.startswith("c_auto_")
    # missing 'page' defaulted to 1
    assert claims[0].page == 1
    # None page coerced to 1
    assert claims[2].page == 1


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
