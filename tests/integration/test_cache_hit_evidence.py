"""Cache-hit evidence rebinding (fix #6).

On a cache hit, the rebound finding's evidence_ids must resolve to Evidence
rows the node actually emits into THIS job — not dangling pointers to the
original cached job's rows. Otherwise the confidence calculator sees zero
evidence and produces a breakdown that contradicts the finding's confidence.
"""
from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from argus.agents.unified_verifier import VERIFIER_VERSION
from argus.cache.finding_cache import FindingCache
from argus.cache.key import claim_cache_key
from argus.config import Settings
from argus.engineering import BoundedRunner, BudgetTracker
from argus.models.domain import (
    Claim,
    ClaimType,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    Severity,
)
from argus.orchestrator.context import _Ctx, _Publisher
from argus.orchestrator.nodes.unified_verifier import _unified_verifier_node


def _claim() -> Claim:
    return Claim(
        id="a_1", text="Acme Q3 revenue grew 42%.", type=ClaimType.NUMERICAL_DATA,
        importance="high", span=(0, 25), page=1,
    )


def _cached_finding() -> Finding:
    return Finding(
        id="fnd_old", job_id="job_old", claim_id="claim_old",
        agent="UnifiedVerifier", verdict=FindingVerdict.OK, severity=Severity.MINOR,
        confidence=0.95, summary="Verified.",
        evidence_ids=["ev_old_1", "ev_old_2"], reasoning_trace_id="trace_old",
    )


def _cached_evidences() -> list[Evidence]:
    return [
        Evidence(
            id="ev_old_1", source_type=EvidenceSource.COMPANY_FILING,
            url="https://sec.gov/a", citation="10-Q", snippet="42%",
            retrieved_at=datetime.utcnow(), retrieved_by_step_id="step_old",
        ),
        Evidence(
            id="ev_old_2", source_type=EvidenceSource.WEB_PAGE,
            url="https://example.com/b", citation="Example", snippet="42 percent",
            retrieved_at=datetime.utcnow(), retrieved_by_step_id="step_old",
        ),
    ]


def _ctx(cache: FindingCache) -> _Ctx:
    return _Ctx(
        client=AsyncMock(),  # never called on a cache hit
        settings=Settings(miromind_api_key="x"),
        budget=BudgetTracker(max_usd=10.0),
        runners={"unified_verifier": BoundedRunner(max_concurrent=2)},
        job_id="job_new",
        publisher=_Publisher(job_id="job_new", bus=None),
        content_domain="finance",
        cache=cache,
    )


@pytest.mark.asyncio
async def test_cache_hit_rebinds_evidence_into_job(test_sessionmaker) -> None:
    cache = FindingCache(test_sessionmaker, default_ttl_days=30)
    claim = _claim()
    key = claim_cache_key(claim.text, domain="finance", version=VERIFIER_VERSION)
    await cache.put(
        key, finding=_cached_finding(), evidences=_cached_evidences(),
        verifier_version=VERIFIER_VERSION, content_domain="finance",
    )

    node = _unified_verifier_node(_ctx(cache))
    result = await node({"claims": [claim]})

    findings = result["findings"]
    evidences = result["evidences"]
    assert len(findings) == 1
    f = next(iter(findings.values()))
    assert f.from_cache is True
    assert f.job_id == "job_new"
    assert f.claim_id == "a_1"

    # Evidence count preserved from cache.
    assert len(evidences) == len(_cached_evidences()) == 2
    # No dangling pointers: every evidence_id resolves within this job's set.
    job_ev_ids = {e.id for e in evidences}
    assert set(f.evidence_ids) == job_ev_ids
    # IDs were freshly minted (not the old cached IDs).
    assert all(eid not in {"ev_old_1", "ev_old_2"} for eid in f.evidence_ids)
    # Content carried over so detail cards still render.
    assert {e.snippet for e in evidences} == {"42%", "42 percent"}
