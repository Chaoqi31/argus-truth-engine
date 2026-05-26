"""End-to-end cache verification: put → get returns the same Finding."""
from datetime import datetime

import pytest

from argus.cache.finding_cache import FindingCache
from argus.cache.key import claim_cache_key
from argus.models.domain import (
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    Severity,
)


def _sample_finding() -> Finding:
    return Finding(
        id="fnd_test",
        job_id="job_test",
        claim_id="claim_test",
        agent="UnifiedVerifier",
        verdict=FindingVerdict.OK,
        severity=Severity.MINOR,
        confidence=0.95,
        summary="Verified.",
        reasoning_trace_id="trace_test",
    )


def _sample_evidence() -> Evidence:
    return Evidence(
        id="ev_test",
        source_type=EvidenceSource.WEB_PAGE,
        url="https://example.com",
        citation="Example Domain",
        snippet="...",
        retrieved_at=datetime.utcnow(),
        retrieved_by_step_id="step_test",
    )


@pytest.mark.asyncio
async def test_cache_put_then_get_returns_same(test_sessionmaker):
    cache = FindingCache(test_sessionmaker, default_ttl_days=30)
    key = claim_cache_key("Sample claim.", domain="finance", version="v1")

    await cache.put(
        key,
        finding=_sample_finding(),
        evidences=[_sample_evidence()],
        verifier_version="v1",
        content_domain="finance",
    )

    result = await cache.get(key)
    assert result is not None
    finding, evidences = result
    assert finding.verdict == FindingVerdict.OK
    assert finding.confidence == 0.95
    assert len(evidences) == 1
    assert evidences[0].url == "https://example.com"


@pytest.mark.asyncio
async def test_cache_miss_on_unknown_key(test_sessionmaker):
    cache = FindingCache(test_sessionmaker)
    result = await cache.get("nonexistent_key_" + "0" * 50)
    assert result is None
