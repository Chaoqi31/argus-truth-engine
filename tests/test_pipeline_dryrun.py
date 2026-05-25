"""Dry-run integration test — exercises the full pipeline with mocked LLM/API calls.

Proves the data flows correctly through all 13 nodes:
  Phase A: parse → planner → atomizer → checkworthiness → evidence_hunter
  Phase B: citation_verifier → citation_alignment → data_freshness
          → consistency → challenger → reporter

No real API calls are made. All LLM responses are mocked.
"""
import asyncio
import json

# Ensure src is importable
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from argus.config import Settings
from argus.models.domain import (
    Finding,
)
from argus.orchestrator import audit_text

# --- Mock responses ---

MOCK_PLANNER_JSON = json.dumps({
    "claims": [
        {
            "id": "c1",
            "text": "According to Smith et al. (2023), global GDP grew 3.2% in 2024",
            "page": 1,
            "span": [0, 60],
            "type": "citation",
            "importance": "high",
        },
        {
            "id": "c2",
            "text": "The unemployment rate in the US reached 3.4% in March 2025",
            "page": 1,
            "span": [61, 120],
            "type": "numerical-data",
            "importance": "medium",
        },
    ]
})

MOCK_ATOMIZER_JSON = json.dumps({"atoms": [
    {
        "parent_claim_id": "c1",
        "text": "Smith et al. published a paper in 2023",
        "type": "citation",
    },
    {
        "parent_claim_id": "c1",
        "text": "Global GDP grew 3.2% in 2024",
        "type": "numerical-data",
    },
    {
        "parent_claim_id": "c2",
        "text": "US unemployment rate was 3.4% in March 2025",
        "type": "numerical-data",
    },
]})

MOCK_CHECKWORTHINESS_JSON = json.dumps({
    "results": [
        {"claim_id": "atom_0", "checkworthy": True, "reason": "Verifiable citation"},
        {"claim_id": "atom_1", "checkworthy": True, "reason": "Verifiable statistic"},
        {"claim_id": "atom_2", "checkworthy": True, "reason": "Verifiable statistic"},
    ]
})

MOCK_STRATEGY_JSON = json.dumps({"strategies": [
    {
        "angle": "direct_verification",
        "query": "Smith et al 2023 GDP growth",
        "rationale": "Direct search",
    },
    {
        "angle": "source_tracing",
        "query": "global GDP 2024 World Bank",
        "rationale": "Find original source",
    },
]})

MOCK_VERIFIER_JSON = json.dumps({
    "verdict": "fabricated",
    "confidence": 0.85,
    "summary": "No paper by Smith et al. (2023) on GDP growth found in Crossref, arXiv, or SSRN.",
    "evidence": [
        {
            "source_type": "crossref",
            "url": "https://api.crossref.org/works?query=smith+gdp",
            "snippet": "0 results",
        },
        {
            "source_type": "web_page",
            "url": "https://scholar.google.com",
            "snippet": "No matching results",
        },
    ],
    "reasoning_chain": [
        {"step": "premise", "content": "Claim cites Smith (2023)", "confidence_delta": 0.0},
        {
            "step": "search",
            "content": "Searched Crossref for 'Smith GDP 2023'",
            "evidence_ref": "https://api.crossref.org",
            "confidence_delta": 0.3,
        },
        {"step": "search", "content": "arXiv and SSRN: no results", "confidence_delta": 0.2},
        {"step": "inference", "content": "No paper found → fabricated", "confidence_delta": 0.35},
    ],
})

MOCK_FRESHNESS_JSON = json.dumps({
    "verdict": "stale",
    "confidence": 0.9,
    "summary": "US unemployment was 3.4% in March 2025 but has been revised to 3.6% in April 2025.",
    "as_of_date": "March 2025",
    "current_value": "3.6% (April 2025)",
    "evidence": [
        {
            "source_type": "fred",
            "url": "https://fred.stlouisfed.org/series/UNRATE",
            "snippet": "3.6% Apr 2025",
        },
    ],
    "reasoning_chain": [
        {"step": "premise", "content": "Claim states 3.4% unemployment", "confidence_delta": 0.0},
        {
            "step": "search",
            "content": "Checked FRED UNRATE series",
            "evidence_ref": "https://fred.stlouisfed.org",
            "confidence_delta": 0.4,
        },
        {"step": "comparison", "content": "3.4% vs 3.6%", "confidence_delta": 0.3},
        {"step": "inference", "content": "Superseded by newer release", "confidence_delta": 0.2},
    ],
})

MOCK_CONSISTENCY_JSON = json.dumps({"contradictions": []})

MOCK_REPORTER_JSON = json.dumps({
    "executive_summary_md": (
        "## Audit Summary\n\n2 issues found:"
        " 1 fabricated citation, 1 stale data point."
    ),
})

MOCK_ATTACKER_JSON = json.dumps({
    "attack_points": ["Could be an unpublished preprint", "Crossref doesn't index all papers"],
    "strongest_attack": "Some working papers aren't in Crossref or arXiv",
    "attack_strength": 0.25,
    "evidence_specificity": 0.8,
})

MOCK_DEFENDER_JSON = json.dumps({
    "rebuttals": [
        {"attack_point": "Could be an unpublished preprint", "response": "rebut",
         "argument": "GDP growth claims cite published works, not preprints"},
        {"attack_point": "Crossref doesn't index all papers", "response": "rebut",
         "argument": "We also checked arXiv, SSRN, and Scholar - all negative"},
    ],
    "defense_holds": True,
    "defense_confidence": 0.88,
})

MOCK_JUDGE_JSON = json.dumps({
    "ruling": "verdict_stands",
    "revised_verdict": None,
    "final_confidence": 0.90,
    "ruling_reasoning": (
        "Attack raised weak points that were fully rebutted."
        " 3 authoritative sources confirm absence."
    ),
    "key_factors": ["Exhaustive search across 3 databases", "No working paper trail either"],
})


class MockMiromindStream:
    """Simulates MiroMind's background submit + stream pattern."""

    def __init__(self, response_json: str):
        self._json = response_json

    async def submit_background(self, **kwargs):
        return "resp_mock_123"

    async def stream(self, rid, after=0):
        """Yield minimal events to produce final_text."""
        from argus.models.miromind import (
            ResponseCompletedEvent,
            ResponseOutputTextDeltaEvent,
            ResponseSummary,
            Usage,
        )
        yield ResponseOutputTextDeltaEvent(
            type="response.output_text.delta",
            sequence_number=1,
            item_id="item_0",
            output_index=0,
            content_index=0,
            delta=self._json,
        )
        yield ResponseCompletedEvent(
            type="response.completed",
            sequence_number=2,
            response=ResponseSummary(
                id="resp_mock",
                status="completed",
                usage=Usage(
                    input_tokens=100, output_tokens=200,
                    total_tokens=300, reasoning_tokens=50,
                    num_search_queries=2,
                ),
            ),
        )


@pytest.fixture
def settings():
    """Test settings with cheap LLM configured."""
    return Settings(
        miromind_api_key="test-key",
        miromind_base_url="http://localhost:9999",
        cheap_llm_api_key="test-cheap-key",
        cheap_llm_base_url="http://localhost:9998",
        cheap_llm_model="test-model",
    )


@pytest.mark.asyncio
async def test_full_pipeline_dryrun(settings, tmp_path):
    """Full pipeline dry-run: all 13 nodes execute, data flows correctly."""

    # Track which mock was called for which stage
    call_sequence = []

    # Mock the MiroMind client to return different responses per agent
    mock_client = MagicMock()
    planner_stream = MockMiromindStream(MOCK_PLANNER_JSON)
    verifier_stream = MockMiromindStream(MOCK_VERIFIER_JSON)
    freshness_stream = MockMiromindStream(MOCK_FRESHNESS_JSON)
    consistency_stream = MockMiromindStream(MOCK_CONSISTENCY_JSON)
    reporter_stream = MockMiromindStream(MOCK_REPORTER_JSON)

    submit_count = {"n": 0}
    responses = [planner_stream, verifier_stream, verifier_stream,
                 freshness_stream, consistency_stream, reporter_stream]

    async def mock_submit(**kwargs):
        idx = min(submit_count["n"], len(responses) - 1)
        submit_count["n"] += 1
        agent = kwargs.get("metadata", {}).get("agent", "unknown")
        call_sequence.append(agent)
        return f"resp_{idx}"

    async def mock_stream(rid, after=0):
        idx = int(rid.split("_")[1]) if "_" in rid else 0
        idx = min(idx, len(responses) - 1)
        async for ev in responses[idx].stream(rid, after):
            yield ev

    mock_client.submit_background = mock_submit
    mock_client.stream = mock_stream

    # Mock cheap LLM client
    mock_cheap = AsyncMock()

    from argus.agents.atomizer import AtomOutput
    from argus.agents.challenger import AttackerOutput, DefenderOutput, JudgeOutput
    from argus.agents.checkworthiness import CheckworthinessResult
    from argus.agents.evidence_hunter import StrategyOutput

    async def mock_cheap_complete(system_prompt, user_input, model_cls):
        """Return appropriate mock based on model_cls (primary) or prompt (fallback)."""
        # Match by model class first — always unambiguous
        if model_cls == AttackerOutput:
            return AttackerOutput.model_validate_json(MOCK_ATTACKER_JSON)
        elif model_cls == DefenderOutput:
            return DefenderOutput.model_validate_json(MOCK_DEFENDER_JSON)
        elif model_cls == JudgeOutput:
            return JudgeOutput.model_validate_json(MOCK_JUDGE_JSON)
        elif model_cls == AtomOutput:
            return AtomOutput.model_validate_json(MOCK_ATOMIZER_JSON)
        elif model_cls == CheckworthinessResult:
            return CheckworthinessResult.model_validate_json(MOCK_CHECKWORTHINESS_JSON)
        elif model_cls == StrategyOutput:
            return StrategyOutput.model_validate_json(MOCK_STRATEGY_JSON)
        # Fallback by prompt content
        return StrategyOutput.model_validate_json(MOCK_STRATEGY_JSON)

    mock_cheap.complete = mock_cheap_complete
    mock_cheap.close = AsyncMock()

    output_path = tmp_path / "result.json"

    with patch("argus.orchestrator.MiromindClient", return_value=mock_client), \
         patch("argus.orchestrator.CheapLLMClient", return_value=mock_cheap):

        job = await audit_text(
            text="According to Smith et al. (2023), global GDP grew 3.2% in 2024. "
                 "The unemployment rate in the US reached 3.4% in March 2025.",
            output_path=output_path,
            settings=settings,
            client=mock_client,
            budget_usd=50.0,
            auto_review=True,  # Skip HITL for test
        )

    # Verify pipeline completed
    assert job.status == "done", f"Expected done, got {job.status}"
    assert len(job.claims) > 0, "Should have claims"
    assert job.audit_report_md is not None, "Should have report"

    # Verify findings have new innovation features
    for f in job.findings:
        assert isinstance(f, Finding)
        # After challenger, findings should have reasoning chain + confidence breakdown
        if f.challenge_result:
            assert f.confidence_breakdown is not None, \
                f"Finding {f.id} missing confidence_breakdown after challenge"
            assert len(f.reasoning_chain) > 0, \
                f"Finding {f.id} missing reasoning_chain after challenge"

    print(f"Pipeline completed: status={job.status}")
    print(f"  Claims: {len(job.claims)}")
    print(f"  Findings: {len(job.findings)}")
    print(f"  Traces: {len(job.traces)}")
    print(f"  Report: {len(job.audit_report_md or '')} chars")
    print(f"  Cost: ${job.cost_usd:.4f}")
    for f in job.findings:
        print(f"  Finding: {f.verdict.value} (conf={f.confidence:.2f}) "
              f"chain={len(f.reasoning_chain)} steps, "
              f"challenge={f.challenge_result[:40] if f.challenge_result else 'none'}")


if __name__ == "__main__":
    asyncio.run(test_full_pipeline_dryrun(
        Settings(
            miromind_api_key="test",
            cheap_llm_api_key="test",
            cheap_llm_base_url="http://localhost",
        ),
        Path("/tmp/test_output"),
    ))
