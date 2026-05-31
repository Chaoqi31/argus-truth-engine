"""Tests for the UnifiedVerifier agent."""
from __future__ import annotations

import json

import pytest

from argus.agents.base import _extract_json
from argus.agents.unified_verifier import (
    SYSTEM_PROMPT,
    UnifiedVerifierOutput,
    build_verifier_input,
    verify_claim,
)
from argus.models.domain import FindingVerdict
from tests._helpers.mock_miromind import StreamRouter, completed, msg


def _parse(text: str) -> UnifiedVerifierOutput:
    """Mirror AgentRunner._validate: extract/repair JSON then validate."""
    return UnifiedVerifierOutput.model_validate_json(_extract_json(text))

# ---------------------------------------------------------------------------
# Prompt hygiene
# ---------------------------------------------------------------------------


def test_system_prompt_does_not_prescribe_specific_apis() -> None:
    lower = SYSTEM_PROMPT.lower()
    assert "crossref" not in lower
    assert "fred" not in lower
    assert "arxiv" not in lower
    assert "sec edgar" not in lower


# ---------------------------------------------------------------------------
# build_verifier_input
# ---------------------------------------------------------------------------


def test_build_verifier_input_includes_domain_hint() -> None:
    text = build_verifier_input(
        "GDP grew 3% in 2023.",
        surrounding="In the report it states...",
        domain_hint="Focus on macroeconomic data sources.",
    )
    assert "DOMAIN HINT" in text
    assert "Focus on macroeconomic data sources." in text


def test_build_verifier_input_without_domain_hint() -> None:
    text = build_verifier_input(
        "GDP grew 3% in 2023.",
        surrounding="",
        domain_hint="",
    )
    assert "DOMAIN HINT" not in text


def test_build_verifier_input_includes_claim_and_surrounding() -> None:
    text = build_verifier_input(
        "The vaccine was approved in 2020.",
        surrounding="According to the WHO,",
        domain_hint="",
    )
    assert "The vaccine was approved in 2020." in text
    assert "According to the WHO," in text


# ---------------------------------------------------------------------------
# Output model parsing
# ---------------------------------------------------------------------------


def test_unified_verifier_output_parses() -> None:
    raw = {
        "verdict": "inaccurate",
        "confidence": 0.87,
        "summary": "The figure cited is incorrect; official data shows a different value.",
        "why_wrong": "The GDP growth rate for 2023 was 2.5%, not 3%.",
        "correct_information": {
            "value": "2.5% GDP growth in 2023",
            "source": "World Bank",
            "url": "https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG",
            "retrieved_date": "2024-01-15",
        },
        "evidence": [
            {
                "source_type": "worldbank",
                "url": "https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG",
                "snippet": "GDP growth (annual %): 2.5 for 2023",
            },
            {
                "source_type": "web_page",
                "url": "https://example.com/gdp-report",
                "snippet": "Global growth moderated to 2.5% in 2023",
            },
        ],
        "reasoning_chain": [
            {
                "action": "Searched for official GDP growth rate 2023",
                "observation": "World Bank reports 2.5% annual growth",
                "reasoning": "The authoritative source contradicts the claim of 3%",
            },
            {
                "action": "Cross-checked with a secondary news source",
                "observation": "Secondary source also cites 2.5%",
                "reasoning": "Two independent sources agree; claim is inaccurate",
            },
        ],
    }
    out = UnifiedVerifierOutput.model_validate(raw)
    assert out.verdict == FindingVerdict.INACCURATE
    assert out.confidence == pytest.approx(0.87)
    assert out.why_wrong is not None
    assert out.correct_information is not None
    assert out.correct_information.value == "2.5% GDP growth in 2023"
    assert len(out.evidence) == 2
    assert len(out.reasoning_chain) == 2


def test_unified_verifier_output_ok_verdict() -> None:
    raw = {
        "verdict": "ok",
        "confidence": 0.95,
        "summary": "Claim verified against two independent sources.",
        "why_wrong": None,
        "correct_information": None,
        "evidence": [
            {"source_type": "web_page", "url": "https://example.com/a", "snippet": "confirmed"},
            {"source_type": "wikipedia", "url": "https://en.wikipedia.org/wiki/X", "snippet": "ok"},
        ],
        "reasoning_chain": [
            {"action": "search", "observation": "found matching data", "reasoning": "consistent"},
            {"action": "cross-check", "observation": "second source agrees", "reasoning": "ok"},
        ],
    }
    out = UnifiedVerifierOutput.model_validate(raw)
    assert out.verdict == FindingVerdict.OK
    assert out.why_wrong is None
    assert out.correct_information is None


# ---------------------------------------------------------------------------
# MiroThinker messy-JSON robustness — the verifier MUST NOT lose a (paid)
# verdict to formatting quirks the deep-research model actually produces.
# ---------------------------------------------------------------------------


def test_parses_list_wrapped_object() -> None:
    """MiroThinker sometimes wraps the result in [ {...} ]."""
    out = _parse('[{"verdict":"fabricated","confidence":0.8,"summary":"no such paper",'
                 '"evidence":[],"reasoning_chain":[]}]')
    assert out.verdict == FindingVerdict.FABRICATED


def test_evidence_with_source_instead_of_source_type() -> None:
    """It labels evidence with `source` (not `source_type`) and drops snippet —
    the item must still survive so the verdict keeps its backing."""
    out = _parse('{"verdict":"ok","confidence":0.9,"summary":"verified",'
                 '"evidence":[{"source":"World Bank","url":"https://data.worldbank.org"},'
                 '{"source":"Reuters","url":"https://reuters.com/x"}],'
                 '"reasoning_chain":[]}')
    assert out.verdict == FindingVerdict.OK
    assert len(out.evidence) == 2  # both kept despite the wrong key
    assert out.evidence[0].url == "https://data.worldbank.org"


def test_reasoning_steps_missing_subfields() -> None:
    """Steps with only `action` (no observation/reasoning) must still parse."""
    out = _parse('{"verdict":"inaccurate","confidence":0.7,"summary":"wrong number",'
                 '"why_wrong":"off by 2x","evidence":[],'
                 '"reasoning_chain":[{"action":"searched FRED"},{"action":"compared values"}]}')
    assert len(out.reasoning_chain) == 2
    assert out.reasoning_chain[0].action == "searched FRED"


def test_code_fence_and_trailing_comma() -> None:
    """Fenced output with a trailing comma — json_repair should recover it."""
    out = _parse('```json\n{"verdict":"outdated","confidence":0.6,"summary":"stale",'
                 '"evidence":[],"reasoning_chain":[],}\n```')
    assert out.verdict == FindingVerdict.OUTDATED


def test_partial_output_minimal_fields_still_yields_verdict() -> None:
    """A truncated response with only the headline fields must still produce a
    usable verdict rather than being discarded."""
    out = _parse('{"verdict":"fabricated","confidence":0.75,"summary":"not found anywhere"}')
    assert out.verdict == FindingVerdict.FABRICATED
    assert out.evidence == []
    assert out.reasoning_chain == []


# ---------------------------------------------------------------------------
# End-to-end with StreamRouter mock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verify_claim_end_to_end() -> None:
    response_payload = json.dumps(
        {
            "verdict": "outdated",
            "confidence": 0.80,
            "summary": "The figure was accurate in 2019 but has since been revised.",
            "why_wrong": "More recent data supersedes the cited figure.",
            "correct_information": {
                "value": "Updated figure from 2023",
                "source": "Official statistics body",
                "url": None,
                "retrieved_date": "2024-01-01",
            },
            "evidence": [
                {
                    "source_type": "web_page",
                    "url": "https://stats.example.com/2023",
                    "snippet": "Latest figure: updated",
                },
                {
                    "source_type": "web_page",
                    "url": "https://news.example.com/revision",
                    "snippet": "Statistics revised upward",
                },
            ],
            "reasoning_chain": [
                {
                    "action": "Searched for current data",
                    "observation": "Found a 2023 revision",
                    "reasoning": "Claim reflects outdated 2019 figure",
                },
                {
                    "action": "Fetched official statistics page",
                    "observation": "Official page confirms the revision",
                    "reasoning": "Two sources confirm claim is outdated",
                },
            ],
        }
    )

    router = StreamRouter()
    router.add("unified_verifier", [msg(response_payload), completed(tokens=120)])

    result = await verify_claim(
        router.make_client(),
        "Unemployment was 4.2% in 2019.",
        surrounding="According to the national bureau of statistics,",
        domain_hint="Focus on labour market statistics.",
    )

    assert result.parsed.verdict == FindingVerdict.OUTDATED
    assert result.parsed.confidence == pytest.approx(0.80)
    assert result.parsed.correct_information is not None
    assert len(result.parsed.evidence) == 2
    assert len(result.parsed.reasoning_chain) == 2
    # Verify the domain hint reached the agent input
    call_text = router.calls_for("unified_verifier")[0]
    assert "DOMAIN HINT" in call_text
    assert "Focus on labour market statistics." in call_text
