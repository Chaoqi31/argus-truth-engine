"""Round-trip tests for the SQLAlchemy models against the domain types."""
from __future__ import annotations

import datetime as _dt

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.db.models import (
    Base,
    EvidenceRow,
    FindingRow,
    JobRow,
    ReasoningTraceRow,
    StepRow,
)
from argus.models.domain import (
    Claim,
    ClaimType,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    Job,
    ReasoningTrace,
    Severity,
    Step,
    StepType,
)


def _sample_job() -> Job:
    claim = Claim(
        id="c1",
        text="Smith (2021) on widgets.",
        page=1,
        span=(0, 22),
        type=ClaimType.CITATION,
        importance="high",
        extracted_metadata={"authors": ["Smith"], "year": 2021},
    )
    step = Step(
        id="s1",
        trace_id="t1",
        sequence=1,
        type=StepType.THINKING,
        summary="Considering Crossref.",
        content={"thought": "..."},
        evidence_ids=[],
        parent_step_id=None,
    )
    trace = ReasoningTrace(
        id="t1",
        job_id="j1",
        claim_id="c1",
        agent="CitationVerifier",
        miromind_response_id="resp_w_demo",
        started_at=_dt.datetime(2026, 5, 20, 1, 0, 0),
        completed_at=None,
        total_tokens=100,
        reasoning_tokens=40,
        num_search_queries=1,
        steps=[step],
    )
    evidence = Evidence(
        id="e1",
        source_type=EvidenceSource.CROSSREF,
        url="https://api.crossref.org/works?x=1",
        citation="Crossref query",
        snippet="{}",
        full_content_ref=None,
        retrieved_by_step_id="s1",
    )
    finding = Finding(
        id="f1",
        job_id="j1",
        claim_id="c1",
        agent="CitationVerifier",
        verdict=FindingVerdict.FABRICATED,
        severity=Severity.MAJOR,
        confidence=0.95,
        summary="Not found.",
        evidence_ids=["e1"],
        reasoning_trace_id="t1",
        related_finding_ids=[],
    )
    return Job(
        id="j1",
        pdf_path="examples/sample-report.pdf",
        status="done",
        cost_usd=0.42,
        total_tokens=100,
        audit_report_md="**1 issue** found.",
        claims=[claim],
        findings=[finding],
        traces=[trace],
        evidences=[evidence],
    )


async def test_job_round_trip(sqlite_engine: object) -> None:
    smaker = async_sessionmaker(sqlite_engine, expire_on_commit=False)
    job = _sample_job()

    async with smaker() as session:
        row = JobRow.from_domain(job)
        session.add(row)
        await session.commit()

    async with smaker() as session:
        row = (
            await session.execute(select(JobRow).where(JobRow.id == job.id))
        ).scalar_one()
        restored = row.to_domain()

    assert restored.id == job.id
    assert restored.status == "done"
    assert restored.audit_report_md == "**1 issue** found."
    assert len(restored.claims) == 1
    assert restored.claims[0].type == ClaimType.CITATION
    assert restored.claims[0].span == (0, 22)
    assert len(restored.findings) == 1
    assert restored.findings[0].verdict == FindingVerdict.FABRICATED
    assert len(restored.traces) == 1
    assert restored.traces[0].steps[0].type == StepType.THINKING
    assert len(restored.evidences) == 1
    assert restored.evidences[0].source_type == EvidenceSource.CROSSREF
    assert restored.evidences[0].url == "https://api.crossref.org/works?x=1"


def test_individual_row_types_exist() -> None:
    """Smoke: ensure each row class is mapped and registered with Base."""
    assert JobRow.__tablename__ == "jobs"
    assert FindingRow.__tablename__ == "findings"
    assert ReasoningTraceRow.__tablename__ == "traces"
    assert StepRow.__tablename__ == "steps"
    assert EvidenceRow.__tablename__ == "evidences"
    assert Base.metadata.tables.keys() >= {
        "jobs",
        "findings",
        "traces",
        "steps",
        "evidences",
    }
