"""End-to-end cache verification: put → get returns the same verdict."""
from datetime import datetime

import pytest

from argus.cache.finding_cache import CachedVerdict, FindingCache
from argus.cache.key import claim_cache_key
from argus.models.domain import (
    Agent,
    Engine,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    ReasoningTrace,
    Severity,
    Step,
    StepType,
    Usage,
)


def _sample_finding() -> Finding:
    return Finding(
        id="fnd_test",
        claim_id="claim_test",
        agent="verifier",
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


def _sample_verdict(evidences: tuple[Evidence, ...] = ()) -> CachedVerdict:
    return CachedVerdict(
        finding=_sample_finding().model_copy(
            update={"evidence_ids": tuple(e.id for e in evidences)}
        ),
        evidences=evidences,
        trace=ReasoningTrace(
            id="trace_test",
            agent=Agent.VERIFIER,
            claim_id="claim_test",
            engine=Engine.MIROMIND,
            started_at=datetime.utcnow(),
            usage=Usage(response_ids=("resp_test",), total_tokens=900, cost_usd=0.4),
            steps=(
                Step(
                    id="step_test",
                    trace_id="resp_test",
                    sequence=1,
                    type=StepType.WEB_SEARCH,
                    summary="search: example",
                ),
            ),
        ),
    )


@pytest.mark.asyncio
async def test_cache_put_then_get_returns_same(test_sessionmaker):
    cache = FindingCache(test_sessionmaker, default_ttl_days=30)
    key = claim_cache_key("Sample claim.", domain="finance", version="v1")

    verdict = _sample_verdict((_sample_evidence(),))
    await cache.put(key, verdict, verifier_version="v1", content_domain="finance")

    assert await cache.get(key) == verdict


def test_a_reused_verdict_is_rebound_under_fresh_ids() -> None:
    verdict = _sample_verdict((_sample_evidence(),))
    reused = verdict.for_claim("claim_other")

    trace = reused.trace
    assert (reused.finding.claim_id, trace.claim_id) == ("claim_other", "claim_other")
    assert reused.finding.from_cache
    assert reused.finding.reasoning_trace_id == trace.id != verdict.trace.id
    assert reused.finding.evidence_ids == tuple(e.id for e in reused.evidences)
    assert reused.evidences[0].retrieved_by_step_id == trace.steps[0].id != "step_test"
    assert trace.usage == Usage(response_ids=("resp_test",))


@pytest.mark.asyncio
async def test_cache_miss_on_unknown_key(test_sessionmaker):
    cache = FindingCache(test_sessionmaker)
    result = await cache.get("nonexistent_key_" + "0" * 50)
    assert result is None


@pytest.mark.asyncio
async def test_cache_put_swallows_integrity_error_from_race(
    test_sessionmaker, monkeypatch,
):
    """Concurrent puts of the same key: the loser's IntegrityError is caught.

    Simulated by patching AsyncSession.commit to raise on the next call.
    The contract: put() returns normally; the winning row is preserved.
    """
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.ext.asyncio import AsyncSession

    cache = FindingCache(test_sessionmaker)
    key = claim_cache_key("Race claim.", domain="finance", version="v1")

    # Pre-seed a row — this is the "winner" we expect to survive.
    await cache.put(key, _sample_verdict(), verifier_version="v1", content_domain="finance")

    # Patch commit to raise IntegrityError on the next call (simulates a
    # concurrent writer beating us to the unique constraint).
    original_commit = AsyncSession.commit
    triggered = {"flag": False}

    async def flaky_commit(self):  # type: ignore[no-untyped-def]
        if not triggered["flag"]:
            triggered["flag"] = True
            raise IntegrityError("simulated race", None, Exception())
        return await original_commit(self)

    monkeypatch.setattr(AsyncSession, "commit", flaky_commit)

    # Should not raise — the loser silently drops its write.
    await cache.put(key, _sample_verdict(), verifier_version="v1", content_domain="finance")
    assert triggered["flag"], "test setup: IntegrityError was never raised"

    # Winner's row is still there (restore commit so get() works).
    monkeypatch.setattr(AsyncSession, "commit", original_commit)
    result = await cache.get(key)
    assert result is not None
