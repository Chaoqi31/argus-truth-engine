"""_finalize fills audit-coverage counters so partial results can't masquerade
as complete ones.

`claims_total`   — claims that entered Phase B verification.
`claims_audited` — claims that actually got a UnifiedVerifier verdict
                   (including #2-downgraded and #3-failed uncertains).
On a budget abort, claims_audited < claims_total signals partial coverage.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from argus.config import Settings
from argus.engineering import BudgetTracker
from argus.models.domain import (
    Claim,
    ClaimType,
    Failure,
    FailureKind,
    Finding,
    FindingVerdict,
    Job,
)
from argus.orchestrator.context import _Ctx, _Publisher, _State
from argus.orchestrator.pipeline import _finalize


def _claim(cid: str) -> Claim:
    return Claim(
        id=cid, text=f"claim {cid}", type=ClaimType.NUMERICAL_DATA,
        importance="high", span=(0, 10), page=1,
    )


def _verifier_finding(claim_id: str, verdict: FindingVerdict) -> Finding:
    return Finding(
        id=f"f_{claim_id}", claim_id=claim_id,
        agent="verifier", verdict=verdict, confidence=0.5,
        summary="s", reasoning_trace_id="trace_x",
    )


def _consistency_finding(claim_id: str) -> Finding:
    return Finding(
        id=f"fc_{claim_id}", claim_id=claim_id,
        agent="consistency", verdict=FindingVerdict.CONTRADICTION, confidence=0.5,
        summary="s", reasoning_trace_id="trace_x",
    )


async def _run_finalize(final_state: _State, tmp_path: Path) -> Job:
    ctx = _Ctx(
        llm=AsyncMock(),
        settings=Settings(miromind_api_key="x"),
        budget=BudgetTracker(max_usd=10.0),
        runners={},
        job_id="job_x",
        publisher=_Publisher(job_id="job_x", bus=None),
    )
    return await _finalize(ctx, Job(id="job_x"), final_state, tmp_path / "out.json", None, None)


@pytest.mark.asyncio
async def test_finalize_full_coverage_audited_equals_total(tmp_path: Path) -> None:
    """All Phase-B claims got a verdict → claims_audited == claims_total."""
    claims = [_claim("a_1"), _claim("a_2"), _claim("a_3")]
    f1 = _verifier_finding("a_1", FindingVerdict.OK)
    f2 = _verifier_finding("a_2", FindingVerdict.FABRICATED)
    f3 = _verifier_finding("a_3", FindingVerdict.UNCERTAIN)
    fc1 = _consistency_finding("a_1")
    final_state: _State = {
        "claims": claims,
        "findings": {
            f1.id: f1,
            f2.id: f2,
            f3.id: f3,
            fc1.id: fc1,
        },
    }
    job = await _run_finalize(final_state, tmp_path)
    assert job.claims_total == 3
    assert job.claims_audited == 3


@pytest.mark.asyncio
async def test_finalize_partial_coverage_on_abort(tmp_path: Path) -> None:
    """Budget abort left 1 of 3 claims unverified → audited < total."""
    claims = [_claim("a_1"), _claim("a_2"), _claim("a_3")]
    f1 = _verifier_finding("a_1", FindingVerdict.OK)
    f2 = _verifier_finding("a_2", FindingVerdict.INACCURATE)
    final_state: _State = {
        "claims": claims,
        "failure": Failure(kind=FailureKind.BUDGET, message="job budget exceeded"),
        "findings": {
            f1.id: f1,
            f2.id: f2,
        },
    }
    job = await _run_finalize(final_state, tmp_path)
    assert job.status == "failed"
    assert job.claims_total == 3
    assert job.claims_audited == 2
    assert job.claims_audited < job.claims_total
