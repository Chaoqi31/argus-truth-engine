"""JobRepository stores each audit as one document."""
from __future__ import annotations

import datetime as _dt

from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.api.runner import Runner
from argus.config import Settings
from argus.db.repository import JobRepository
from argus.llm import Transports
from argus.models.domain import (
    Agent,
    Claim,
    ClaimType,
    ConfidenceBreakdown,
    Engine,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    ReasoningTrace,
    Severity,
    Stage,
    StageFilteredClaim,
    StageKey,
    StageStatus,
    Step,
    StepType,
    Usage,
    VerificationStep,
)
from argus.models.job import FailureKind, Job


def _job(job_id: str, *, status: str = "done", minute: int = 0, text: str | None = None) -> Job:
    """A job with every nested collection populated, nested ids reused across jobs."""
    started = _dt.datetime(2026, 5, 20, 1, minute)
    return Job(
        id=job_id,
        pdf_path="" if text else f"/data/uploads/{job_id}/report.pdf",
        input_text=text,
        input_mode="text" if text else "pdf",
        status=status,
        created_at=started,
        audit_report_md="**1 issue** found.",
        claims=[
            Claim(
                id="c1",
                text="Smith (2021) on widgets.",
                span=(0, 22),
                type=ClaimType.CITATION,
                importance="high",
                extracted_metadata={"authors": ["Smith"], "year": 2021},
                parent_claim_id="c0",
            )
        ],
        traces=[
            ReasoningTrace(
                id="t1",
                claim_id="c1",
                agent=Agent.VERIFIER,
                engine=Engine.MIROMIND,
                started_at=started,
                usage=Usage(response_ids=("resp_1",), total_tokens=100, cost_usd=0.42),
                steps=[
                    Step(
                        id="s1",
                        type=StepType.WEB_SEARCH,
                        summary="Searched Crossref.",
                        content={"query": "Smith 2021 widgets"},
                        created_at=started,
                    )
                ],
            )
        ],
        evidences=[
            Evidence(
                id="e1",
                source_type=EvidenceSource.CROSSREF,
                url="https://api.crossref.org/works?x=1",
                citation="Crossref query",
                retrieved_at=started,
                retrieved_by_step_id="s1",
            )
        ],
        findings=[
            Finding(
                id="f1",
                claim_id="c1",
                agent=Agent.VERIFIER,
                verdict=FindingVerdict.FABRICATED,
                severity=Severity.MAJOR,
                confidence=0.9,
                confidence_breakdown=ConfidenceBreakdown(source_agreement=0.8),
                summary="Not found.",
                reasoning_chain=[
                    VerificationStep(action="search", observation="no match", reasoning="absent")
                ],
                evidence_ids=["e1"],
                reasoning_trace_id="t1",
                created_at=started,
                flags=["single source — verify manually"],
            )
        ],
        stages=[
            Stage(
                key=StageKey.CHECKWORTHINESS,
                engine=Engine.DEEPSEEK,
                status=StageStatus.DONE,
                summary="Kept 1 checkworthy, dropped 1",
                metrics={"n_checkworthy": 1, "n_filtered": 1},
                filtered_claims=(StageFilteredClaim(text="Opinion.", reason="not checkable"),),
            )
        ],
    )


async def test_saved_jobs_read_back_identically(sqlite_engine: object) -> None:
    repo = JobRepository(async_sessionmaker(sqlite_engine, expire_on_commit=False))
    first, second = _job("j_first"), _job("j_second")

    await repo.save_job(first)
    await repo.save_job(second)

    assert await repo.get_job("j_first") == first
    assert await repo.get_job("j_second") == second
    assert await repo.get_job("nope") is None


async def test_save_overwrites_the_document_and_keeps_the_owner(sqlite_engine: object) -> None:
    repo = JobRepository(async_sessionmaker(sqlite_engine, expire_on_commit=False))
    job = _job("j1", status="running")
    await repo.save_job(job, owner_user_id="u_a")

    done = job.model_copy(update={"status": "done", "audit_report_md": "Aborted."})
    await repo.save_job(done)

    assert await repo.get_job("j1") == done
    assert await repo.get_job_owner("j1") == "u_a"


async def test_summaries_are_scoped_to_the_owner_newest_first(sqlite_engine: object) -> None:
    repo = JobRepository(async_sessionmaker(sqlite_engine, expire_on_commit=False))
    await repo.save_job(_job("j_old", minute=1))
    await repo.save_job(_job("j_new", minute=2, text="  Acme   grew 12%\nin 2025. "))
    await repo.save_job(_job("j_other", minute=3), owner_user_id="u_a")

    local = await repo.list_job_summaries(owner_user_id=None)

    assert [(s.id, s.title, s.input_mode) for s in local] == [
        ("j_new", "Acme grew 12% in 2025.", "text"),
        ("j_old", "report.pdf", "pdf"),
    ]
    assert (local[0].findings_count, local[0].claims_audited, local[0].cost_usd) == (1, 1, 0.42)
    assert [s.id for s in await repo.list_job_summaries(owner_user_id="u_a")] == ["j_other"]


async def test_startup_fails_runs_a_restart_cut_off(sqlite_engine: object) -> None:
    repo = JobRepository(async_sessionmaker(sqlite_engine, expire_on_commit=False))
    await repo.save_job(_job("j_running", status="running", minute=1))
    await repo.save_job(_job("j_review", status="awaiting_review", minute=2))
    await repo.save_job(_job("j_done", status="done", minute=3))
    settings = Settings(miromind_api_key="fake", cache_enabled=False)
    transports = Transports(settings)

    await Runner(repo=repo, transports=transports, settings=settings).recover()
    await transports.aclose()

    running = await repo.get_job("j_running")
    assert running is not None and running.status == "failed"
    assert running.failure is not None and running.failure.kind == FailureKind.INTERRUPTED
    assert running.completed_at is not None
    assert [s.status for s in await repo.list_job_summaries(owner_user_id=None)] == [
        "done",
        "awaiting_review",
        "failed",
    ]
