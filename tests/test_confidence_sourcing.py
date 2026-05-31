"""Soft ≥2-source enforcement: count distinct sources from evidence AND the
reasoning chain, then cap confidence + flag under-sourced web verdicts without
discarding them (MiroThinker under-logs sources, so hard rejection would throw
away sound, paid verdicts)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from argus.agents.confidence_calculator import (
    count_distinct_sources,
    evaluate_sourcing,
)
from argus.config import Settings
from argus.models.domain import (
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    VerificationStep,
)
from argus.orchestrator.context import _Ctx
from argus.orchestrator.nodes.confidence import _confidence_node


def _ev(eid: str, url: str | None = None) -> Evidence:
    return Evidence(
        id=eid, source_type=EvidenceSource.WEB_PAGE, url=url,
        citation="c", snippet="s", retrieved_by_step_id="st",
    )


def _finding(
    *,
    verdict: FindingVerdict = FindingVerdict.FABRICATED,
    agent: str = "UnifiedVerifier",
    confidence: float = 0.9,
    chain: list[VerificationStep] | None = None,
    evidence_ids: list[str] | None = None,
) -> Finding:
    return Finding(
        id="f", job_id="j", claim_id="c", agent=agent, verdict=verdict,
        confidence=confidence, summary="s", reasoning_trace_id="t",
        reasoning_chain=chain or [], evidence_ids=evidence_ids or [],
    )


# --- count_distinct_sources -------------------------------------------------

def test_count_dedupes_domains_and_strips_www() -> None:
    evs = [_ev("e1", "https://www.reuters.com/a"),
           _ev("e2", "https://reuters.com/b"),
           _ev("e3", "https://sec.gov/x")]
    assert count_distinct_sources(_finding(), evs) == 2  # reuters + sec.gov


def test_count_includes_reasoning_chain_urls() -> None:
    chain = [VerificationStep(
        action="searched https://arxiv.org/abs/1 then https://crossref.org/y",
        observation="", reasoning="")]
    evs = [_ev("e1", "https://reuters.com/a")]
    assert count_distinct_sources(_finding(chain=chain), evs) == 3


def test_count_urlless_evidence_each_counts() -> None:
    assert count_distinct_sources(_finding(), [_ev("e1"), _ev("e2")]) == 2


# --- evaluate_sourcing ------------------------------------------------------

def test_single_source_caps_and_flags() -> None:
    cap, flag = evaluate_sourcing(_finding(verdict=FindingVerdict.FABRICATED), 1)
    assert cap == 0.6 and flag is not None and "single source" in flag


def test_negative_two_sources_undersourced() -> None:
    cap, flag = evaluate_sourcing(_finding(verdict=FindingVerdict.FABRICATED), 2)
    assert cap == 0.75 and flag is not None and "under-sourced" in flag


def test_positive_two_sources_ok() -> None:
    assert evaluate_sourcing(_finding(verdict=FindingVerdict.OK), 2) == (None, None)


def test_negative_three_sources_ok() -> None:
    assert evaluate_sourcing(_finding(verdict=FindingVerdict.FABRICATED), 3) == (None, None)


def test_uncertain_never_flagged() -> None:
    assert evaluate_sourcing(_finding(verdict=FindingVerdict.UNCERTAIN), 0) == (None, None)


def test_consistency_finding_not_flagged() -> None:
    f = _finding(verdict=FindingVerdict.CONTRADICTION, agent="Consistency")
    assert evaluate_sourcing(f, 0) == (None, None)


# --- node wiring ------------------------------------------------------------

def _ctx() -> _Ctx:
    return _Ctx(
        client=AsyncMock(), settings=Settings(miromind_api_key="x"),
        budget=AsyncMock(), runners={}, job_id="j", publisher=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_node_caps_and_flags_single_source_finding() -> None:
    f = _finding(verdict=FindingVerdict.FABRICATED, confidence=0.95,
                 evidence_ids=["e1"])
    evs = [_ev("e1", "https://reuters.com/a")]  # 1 distinct source
    node = _confidence_node(_ctx())
    await node({"findings": [f], "evidences": evs})

    assert f.confidence == 0.6  # capped from 0.95
    assert any("single source" in fl for fl in f.flags)
    assert f.confidence_breakdown is not None


@pytest.mark.asyncio
async def test_node_leaves_well_sourced_finding_untouched() -> None:
    f = _finding(verdict=FindingVerdict.FABRICATED, confidence=0.9,
                 evidence_ids=["e1", "e2", "e3"])
    evs = [_ev("e1", "https://reuters.com/a"),
           _ev("e2", "https://sec.gov/x"),
           _ev("e3", "https://arxiv.org/y")]  # 3 distinct sources
    node = _confidence_node(_ctx())
    await node({"findings": [f], "evidences": evs})

    assert f.confidence == 0.9  # untouched
    assert f.flags == []
