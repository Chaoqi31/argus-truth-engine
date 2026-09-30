"""The job aggregate: how events change it, and which changes it refuses."""
from __future__ import annotations

from datetime import datetime

import pytest

from argus.models.domain import (
    Agent,
    Claim,
    ClaimType,
    Engine,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    ReasoningTrace,
    StageKey,
    StageStatus,
    Step,
    StepType,
    Usage,
)
from argus.models.job import (
    ClaimsSelected,
    Failure,
    FailureKind,
    FindingRecorded,
    Finished,
    IllegalTransition,
    Job,
    NotAwaitingReview,
    ReviewReady,
    StageFinished,
    StageStarted,
    StepRecorded,
    TraceClosed,
    TraceOpened,
    UnknownClaims,
)

NOW = datetime(2026, 9, 30, 12, 0, 0)


def _claim(cid: str) -> Claim:
    return Claim(id=cid, text=f"claim {cid}", span=(0, 5), type=ClaimType.CITATION,
                 importance="high")


def _finding(fid: str, verdict: FindingVerdict = FindingVerdict.OK) -> Finding:
    return Finding(id=fid, claim_id="c1", agent=Agent.VERIFIER, verdict=verdict,
                   confidence=0.9, summary="s", reasoning_trace_id="t1", evidence_ids=("e1",))


def _evidence(eid: str) -> Evidence:
    return Evidence(id=eid, source_type=EvidenceSource.WEB_PAGE, citation="c",
                    retrieved_by_step_id="s1")


def _paused() -> Job:
    job = Job(id="j1", input_mode="text", input_text="text")
    job.apply(ReviewReady(claims=(_claim("c1"), _claim("c2"), _claim("c3"))))
    return job


def test_every_event_counts_in_the_version() -> None:
    job = Job(id="j1")
    job.apply(StageStarted(key=StageKey.PARSE, engine=Engine.DETERMINISTIC))
    job.apply(StageFinished(key=StageKey.PARSE, summary="read"))

    assert job.version == 2


def test_stages_list_in_pipeline_order_whatever_order_they_start_in() -> None:
    job = Job(id="j1")
    job.apply(StageStarted(key=StageKey.CONSISTENCY, engine=Engine.DEEPSEEK))
    job.apply(StageStarted(key=StageKey.VERIFY, engine=Engine.MIROMIND))
    job.apply(StageFinished(key=StageKey.CONSISTENCY, summary="none", metrics={"n": 0}))

    assert [(s.key, s.status) for s in job.stages] == [
        (StageKey.VERIFY, StageStatus.RUNNING),
        (StageKey.CONSISTENCY, StageStatus.DONE),
    ]
    assert job.stages[1].metrics == {"n": 0}


def test_a_stage_starts_once_and_finishes_once() -> None:
    job = Job(id="j1")
    job.apply(StageStarted(key=StageKey.PARSE, engine=Engine.DETERMINISTIC))
    with pytest.raises(IllegalTransition):
        job.apply(StageStarted(key=StageKey.PARSE, engine=Engine.DETERMINISTIC))
    job.apply(StageFinished(key=StageKey.PARSE, summary="read"))
    with pytest.raises(IllegalTransition):
        job.apply(StageFinished(key=StageKey.PARSE, summary="again"))
    assert job.version == 2


def test_review_pauses_the_job_and_selection_resumes_it_with_the_kept_claims() -> None:
    job = _paused()
    assert (job.status, job.claims_total) == ("awaiting_review", 3)

    job.apply(ClaimsSelected(claim_ids=("c3", "c1")))

    assert job.status == "running"
    assert [c.id for c in job.claims] == ["c1", "c3"]


def test_a_selection_needs_a_paused_job_and_known_claims() -> None:
    with pytest.raises(NotAwaitingReview):
        Job(id="j1").apply(ClaimsSelected(claim_ids=()))
    with pytest.raises(UnknownClaims):
        _paused().apply(ClaimsSelected(claim_ids=("c1", "c9")))


def test_nothing_but_a_selection_changes_a_paused_job() -> None:
    job = _paused()
    with pytest.raises(IllegalTransition):
        job.apply(StageStarted(key=StageKey.VERIFY, engine=Engine.MIROMIND))
    assert job.version == 1


def test_a_trace_grows_step_by_step_until_it_closes() -> None:
    job = Job(id="j1")
    trace = ReasoningTrace(id="t1", agent=Agent.VERIFIER, claim_id="c1",
                           engine=Engine.MIROMIND, started_at=NOW)
    job.apply(TraceOpened(trace=trace))
    job.apply(StepRecorded(trace_id="t1", step=Step(id="s1", type=StepType.THINKING,
                                                    summary="plan")))
    job.apply(StepRecorded(trace_id="t1", step=Step(id="s2", type=StepType.WEB_SEARCH,
                                                    summary="search")))
    usage = Usage(response_ids=("r1",), total_tokens=10, cost_usd=0.5)
    job.apply(TraceClosed(trace_id="t1", usage=usage, completed_at=NOW))

    (recorded,) = job.traces
    assert [s.id for s in recorded.steps] == ["s1", "s2"]
    assert (recorded.usage, recorded.completed_at) == (usage, NOW)
    assert (job.cost_usd, job.total_tokens) == (0.5, 10)
    with pytest.raises(IllegalTransition):
        job.apply(StepRecorded(trace_id="t1", step=Step(id="s3", type=StepType.THINKING,
                                                        summary="late")))


def test_a_revised_finding_replaces_the_original_and_evidence_is_added_once() -> None:
    job = Job(id="j1")
    job.apply(FindingRecorded(finding=_finding("f1"), evidences=(_evidence("e1"),)))
    job.apply(FindingRecorded(finding=_finding("f1", FindingVerdict.UNCERTAIN),
                              evidences=(_evidence("e1"),)))

    assert [(f.id, f.verdict) for f in job.findings] == [("f1", FindingVerdict.UNCERTAIN)]
    assert [e.id for e in job.evidences] == ["e1"]
    assert job.claims_audited == 1


def test_finishing_fails_the_stages_still_running() -> None:
    job = Job(id="j1")
    job.apply(StageStarted(key=StageKey.PARSE, engine=Engine.DETERMINISTIC))
    job.apply(StageFinished(key=StageKey.PARSE, summary="read"))
    job.apply(StageStarted(key=StageKey.PLANNER, engine=Engine.DEEPSEEK))
    failure = Failure(kind=FailureKind.ERROR, message="planner: down")
    job.apply(Finished(status="failed", failure=failure, completed_at=NOW))

    assert (job.status, job.failure, job.completed_at) == ("failed", failure, NOW)
    assert [s.status for s in job.stages] == [StageStatus.DONE, StageStatus.FAILED]
    with pytest.raises(IllegalTransition):
        job.apply(Finished(status="done", completed_at=NOW))


def test_a_failed_run_carries_its_failure_and_a_done_one_none() -> None:
    with pytest.raises(ValueError, match="failure"):
        Finished(status="failed", completed_at=NOW)
    with pytest.raises(ValueError, match="failure"):
        Finished(status="done", failure=Failure(kind=FailureKind.ERROR, message="x"),
                 completed_at=NOW)


def test_the_stored_document_leaves_out_the_derived_totals() -> None:
    job = _paused()
    stored = Job.model_validate_json(job.document_json())

    assert stored == job
    assert "claims_total" not in job.document_json()
