"""_finalize fills audit-coverage counters so partial results can't masquerade
as complete ones.

`claims_total`   — claims that entered Phase B verification.
`claims_audited` — claims that actually got a UnifiedVerifier verdict
                   (including #2-downgraded and #3-failed uncertains).
On a budget abort, claims_audited < claims_total signals partial coverage.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from argus.engineering import BudgetTracker
from argus.models.domain import (
    Claim,
    ClaimType,
    Finding,
    FindingVerdict,
    Job,
)
from argus.orchestrator.context import _Publisher, _State
from argus.orchestrator.pipeline import _finalize


def _claim(cid: str) -> Claim:
    return Claim(
        id=cid, text=f"claim {cid}", type=ClaimType.NUMERICAL_DATA,
        importance="high", span=(0, 10), page=1,
    )


def _verifier_finding(claim_id: str, verdict: FindingVerdict) -> Finding:
    return Finding(
        id=f"f_{claim_id}", job_id="job_x", claim_id=claim_id,
        agent="UnifiedVerifier", verdict=verdict, confidence=0.5,
        summary="s", reasoning_trace_id="trace_x",
    )


def _consistency_finding(claim_id: str) -> Finding:
    return Finding(
        id=f"fc_{claim_id}", job_id="job_x", claim_id=claim_id,
        agent="Consistency", verdict=FindingVerdict.CONTRADICTION, confidence=0.5,
        summary="s", reasoning_trace_id="trace_x",
    )


async def _run_finalize(final_state: _State, tmp_path: Path) -> Job:
    job = Job(id="job_x")
    budget = BudgetTracker(max_usd=10.0)
    publisher = _Publisher(job_id="job_x", bus=None)  # no-op
    return await _finalize(
        job, final_state, budget, publisher, tmp_path / "out.json",
        None, None, None,
    )


@pytest.mark.asyncio
async def test_finalize_full_coverage_audited_equals_total(tmp_path: Path) -> None:
    """All Phase-B claims got a verdict → claims_audited == claims_total."""
    claims = [_claim("a_1"), _claim("a_2"), _claim("a_3")]
    final_state: _State = {
        "claims": claims,
        "findings": [
            _verifier_finding("a_1", FindingVerdict.OK),
            _verifier_finding("a_2", FindingVerdict.FABRICATED),
            _verifier_finding("a_3", FindingVerdict.UNCERTAIN),
            # A Consistency finding must NOT count toward audited coverage.
            _consistency_finding("a_1"),
        ],
    }
    job = await _run_finalize(final_state, tmp_path)
    assert job.claims_total == 3
    assert job.claims_audited == 3


@pytest.mark.asyncio
async def test_finalize_partial_coverage_on_abort(tmp_path: Path) -> None:
    """Budget abort left 1 of 3 claims unverified → audited < total."""
    claims = [_claim("a_1"), _claim("a_2"), _claim("a_3")]
    final_state: _State = {
        "claims": claims,
        "aborted": True,
        "abort_reason": "job budget exceeded",
        "findings": [
            _verifier_finding("a_1", FindingVerdict.OK),
            _verifier_finding("a_2", FindingVerdict.INACCURATE),
        ],
    }
    job = await _run_finalize(final_state, tmp_path)
    assert job.status == "failed"
    assert job.claims_total == 3
    assert job.claims_audited == 2
    assert job.claims_audited < job.claims_total
