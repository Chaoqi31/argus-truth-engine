"""Dry-run integration test — exercises the full pipeline with mocked LLM/API calls.

Proves the data flows correctly through all nodes:
  Phase A: parse → planner → atomizer → checkworthiness
  Phase B: unified_verifier + consistency → confidence → reporter

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

MOCK_VERIFIER_JSON = json.dumps({
    "verdict": "fabricated",
    "confidence": 0.85,
    "summary": "No paper by Smith et al. (2023) on GDP growth found in Crossref, arXiv, or SSRN.",
    "why_wrong": "Paper does not exist in any academic database.",
    "correct_information": None,
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
        {
            "action": "search_crossref",
            "observation": "0 results for Smith GDP 2023",
            "reasoning": "No matching paper found in Crossref.",
        },
        {
            "action": "search_arxiv",
            "observation": "No results",
            "reasoning": "No paper found → fabricated.",
        },
    ],
})

MOCK_FRESHNESS_JSON = json.dumps({
    "verdict": "stale",
    "confidence": 0.9,
    "summary": "US unemployment was 3.4% in March 2025 but has been revised to 3.6% in April 2025.",
    "why_wrong": "Unemployment figure has been revised upward in April 2025 release.",
    "correct_information": {
        "value": "3.6%",
        "source": "FRED UNRATE series April 2025",
    },
    "evidence": [
        {
            "source_type": "fred",
            "url": "https://fred.stlouisfed.org/series/UNRATE",
            "snippet": "3.6% Apr 2025",
        },
    ],
    "reasoning_chain": [
        {
            "action": "fetch_fred",
            "observation": "FRED UNRATE shows 3.6% for April 2025",
            "reasoning": "Claim value is stale; superseded by newer release.",
        },
        {
            "action": "compare_values",
            "observation": "3.4% (claim) vs 3.6% (current)",
            "reasoning": "Significant revision warrants stale verdict.",
        },
    ],
})

MOCK_CONSISTENCY_JSON = json.dumps({"contradictions": []})

MOCK_REPORTER_JSON = json.dumps({
    "executive_summary_md": (
        "## Audit Summary\n\n2 issues found:"
        " 1 fabricated citation, 1 stale data point."
    ),
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
    """Full pipeline dry-run: all nodes execute, data flows correctly."""

    # Track which mock was called for which stage
    call_sequence = []

    # Mock the MiroMind client to return different responses per agent
    mock_client = MagicMock()
    verifier_stream = MockMiromindStream(MOCK_VERIFIER_JSON)

    submit_count = {"n": 0}

    async def mock_submit(**kwargs):
        submit_count["n"] += 1
        agent = kwargs.get("metadata", {}).get("agent", "unknown")
        call_sequence.append(agent)
        return "resp_verifier"

    # Only the unified_verifier still uses MiroMind; planner / consistency /
    # reporter now run on the cheap LLM (mock_cheap below).
    async def mock_stream(rid, after=0):
        async for ev in verifier_stream.stream(rid, after):
            yield ev

    mock_client.submit_background = mock_submit
    mock_client.stream = mock_stream

    # Mock cheap LLM client
    mock_cheap = AsyncMock()

    from argus.agents.atomizer import AtomOutput
    from argus.agents.checkworthiness import CheckworthinessResult
    from argus.agents.consistency import ConsistencyOutput
    from argus.agents.planner import PlannerOutput
    from argus.agents.reporter import ReporterOutput

    async def mock_cheap_complete(system_prompt, user_input, model_cls, *, max_tokens=4000):
        """Return appropriate mock based on model_cls. Planner, consistency and
        reporter now run on the cheap LLM too — only the verifier uses MiroMind."""
        payloads = {
            AtomOutput: MOCK_ATOMIZER_JSON,
            CheckworthinessResult: MOCK_CHECKWORTHINESS_JSON,
            PlannerOutput: MOCK_PLANNER_JSON,
            ConsistencyOutput: MOCK_CONSISTENCY_JSON,
            ReporterOutput: MOCK_REPORTER_JSON,
        }
        return model_cls.model_validate_json(payloads.get(model_cls, MOCK_ATOMIZER_JSON))

    mock_cheap.complete = mock_cheap_complete
    mock_cheap.close = AsyncMock()

    output_path = tmp_path / "result.json"

    # Patch CheapLLMClient where it is actually constructed (_build_ctx in
    # pipeline.py imports it from argus.llm.cheap_client). The MiroMind client
    # is injected directly via the `client=` argument below.
    with patch("argus.orchestrator.pipeline.CheapLLMClient", return_value=mock_cheap):

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

    # Verify findings have confidence breakdown from algorithmic calculator
    for f in job.findings:
        assert isinstance(f, Finding)
        assert f.confidence_breakdown is not None, \
            f"Finding {f.id} missing confidence_breakdown"

    print(f"Pipeline completed: status={job.status}")
    print(f"  Claims: {len(job.claims)}")
    print(f"  Findings: {len(job.findings)}")
    print(f"  Traces: {len(job.traces)}")
    print(f"  Report: {len(job.audit_report_md or '')} chars")
    print(f"  Cost: ${job.cost_usd:.4f}")
    for f in job.findings:
        print(f"  Finding: {f.verdict.value} (conf={f.confidence:.2f}) "
              f"chain={len(f.reasoning_chain)} steps")


if __name__ == "__main__":
    asyncio.run(test_full_pipeline_dryrun(
        Settings(
            miromind_api_key="test",
            cheap_llm_api_key="test",
            cheap_llm_base_url="http://localhost",
        ),
        Path("/tmp/test_output"),
    ))
