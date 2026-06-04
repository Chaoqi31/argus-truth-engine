"""JobRepository round-trip + listing."""
from __future__ import annotations

import datetime as _dt

from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.db.repository import JobRepository
from argus.models.domain import (
    Claim,
    ClaimType,
    ConfidenceBreakdown,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    Job,
    ReasoningTrace,
    Severity,
    Stage,
    StageFilteredClaim,
    Step,
    StepType,
)

# Re-use the helper from test_db_models to avoid duplication.
from tests.test_db_models import _sample_job


async def test_save_then_get(sqlite_engine: object) -> None:
    smaker = async_sessionmaker(sqlite_engine, expire_on_commit=False)
    repo = JobRepository(smaker)
    job = _sample_job()

    await repo.save_job(job)
    loaded = await repo.get_job(job.id)

    assert loaded is not None
    assert loaded.id == job.id
    assert len(loaded.findings) == 1
    assert loaded.findings[0].verdict == job.findings[0].verdict


async def test_confidence_breakdown_round_trips(sqlite_engine: object) -> None:
    smaker = async_sessionmaker(sqlite_engine, expire_on_commit=False)
    repo = JobRepository(smaker)

    job = _sample_job()
    breakdown = ConfidenceBreakdown(
        source_agreement=0.8,
        source_authority=0.6,
        evidence_freshness=0.4,
        reasoning="Authoritative sources broadly agree.",
    )
    job.findings[0].confidence_breakdown = breakdown

    await repo.save_job(job)
    loaded = await repo.get_job(job.id)

    assert loaded is not None
    restored = loaded.findings[0].confidence_breakdown
    assert restored == breakdown


async def test_stages_round_trip(sqlite_engine: object) -> None:
    smaker = async_sessionmaker(sqlite_engine, expire_on_commit=False)
    repo = JobRepository(smaker)

    job = _sample_job()
    job.stages = [
        Stage(
            key="filtering",
            name="Triage",
            engine="deepseek",
            summary="Dropped 2 non-checkable claims.",
            metrics={"in": 5, "out": 3},
            strategy="keep numeric + citation claims",
            filtered_claims=[
                StageFilteredClaim(
                    claim_id="c9", text="Opinion sentence.", reason="not checkable"
                ),
            ],
        ),
    ]

    await repo.save_job(job)
    loaded = await repo.get_job(job.id)

    assert loaded is not None
    assert len(loaded.stages) == 1
    stage = loaded.stages[0]
    assert stage.key == "filtering"
    assert stage.engine == "deepseek"
    assert stage.metrics == {"in": 5, "out": 3}
    assert stage.filtered_claims is not None
    assert stage.filtered_claims[0].claim_id == "c9"
    assert stage.filtered_claims[0].reason == "not checkable"


async def test_get_missing_returns_none(sqlite_engine: object) -> None:
    smaker = async_sessionmaker(sqlite_engine, expire_on_commit=False)
    repo = JobRepository(smaker)
    assert await repo.get_job("nope") is None


async def test_list_jobs_returns_recent_first(sqlite_engine: object) -> None:
    smaker = async_sessionmaker(sqlite_engine, expire_on_commit=False)
    repo = JobRepository(smaker)

    # Build two independent jobs (don't share nested-row IDs).
    j1 = _independent_sample_job("first")
    j2 = _independent_sample_job("second")
    await repo.save_job(j1)
    await repo.save_job(j2)

    listed = await repo.list_jobs(limit=10)
    ids = [j.id for j in listed]
    assert set(ids) == {"j_first", "j_second"}


async def test_save_job_is_upsert(sqlite_engine: object) -> None:
    smaker = async_sessionmaker(sqlite_engine, expire_on_commit=False)
    repo = JobRepository(smaker)

    job = _sample_job()
    await repo.save_job(job)

    updated = job.model_copy(update={"status": "failed", "audit_report_md": "Aborted."})
    await repo.save_job(updated)

    loaded = await repo.get_job(job.id)
    assert loaded is not None
    assert loaded.status == "failed"
    assert loaded.audit_report_md == "Aborted."


def _independent_sample_job(suffix: str) -> Job:
    """Sample Job whose ALL nested IDs are namespaced by `suffix`."""
    job_id = f"j_{suffix}"
    claim = Claim(
        id=f"c1_{suffix}",
        text="Smith (2021) on widgets.",
        page=1,
        span=(0, 22),
        type=ClaimType.CITATION,
        importance="high",
        extracted_metadata={},
    )
    step = Step(
        id=f"s1_{suffix}",
        trace_id=f"t1_{suffix}",
        sequence=1,
        type=StepType.THINKING,
        summary="thinking",
        content={"thought": "..."},
        evidence_ids=[],
        parent_step_id=None,
    )
    trace = ReasoningTrace(
        id=f"t1_{suffix}",
        job_id=job_id,
        claim_id=f"c1_{suffix}",
        agent="CitationVerifier",
        miromind_response_id=f"resp_{suffix}",
        started_at=_dt.datetime(2026, 5, 20, 1, 0, 0),
        completed_at=None,
        total_tokens=100,
        reasoning_tokens=40,
        num_search_queries=1,
        steps=[step],
    )
    evidence = Evidence(
        id=f"e1_{suffix}",
        source_type=EvidenceSource.CROSSREF,
        url="https://example.com/x",
        citation="Crossref query",
        snippet="",
        full_content_ref=None,
        retrieved_by_step_id=f"s1_{suffix}",
    )
    finding = Finding(
        id=f"f1_{suffix}",
        job_id=job_id,
        claim_id=f"c1_{suffix}",
        agent="CitationVerifier",
        verdict=FindingVerdict.FABRICATED,
        severity=Severity.MAJOR,
        confidence=0.9,
        summary="Not found.",
        evidence_ids=[f"e1_{suffix}"],
        reasoning_trace_id=f"t1_{suffix}",
        related_finding_ids=[],
    )
    return Job(
        id=job_id,
        pdf_path="x.pdf",
        status="done",
        cost_usd=0.1,
        total_tokens=100,
        audit_report_md=None,
        claims=[claim],
        findings=[finding],
        traces=[trace],
        evidences=[evidence],
    )
