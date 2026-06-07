"""SQLAlchemy 2.0 async declarative models.

Each table mirrors a domain Pydantic model. JSON columns hold structured
sub-fields so the schema stays portable between SQLite (tests) and Postgres
(production).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from argus.models.domain import (
    Claim,
    ClaimCoverage,
    ClaimType,
    ComputationCheck,
    ConfidenceBreakdown,
    CorrectedInfo,
    Evidence,
    EvidenceQuality,
    EvidenceSource,
    Finding,
    FindingVerdict,
    Job,
    ReasoningTrace,
    Severity,
    SkepticReview,
    Stage,
    Step,
    StepType,
)


class Base(DeclarativeBase):
    """Declarative base for all Argus DB models."""


# --- UserRow + UserApiKeyRow ---------------------------------------------


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    jobs: Mapped[list[JobRow]] = relationship(back_populates="owner")
    api_keys: Mapped[list[UserApiKeyRow]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class UserApiKeyRow(Base):
    __tablename__ = "user_api_keys"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String, default="miromind")
    label: Mapped[str] = mapped_column(String, default="MiroMind API key")
    encrypted_key: Mapped[str] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    last4: Mapped[str] = mapped_column(String(8))
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[UserRow] = relationship(back_populates="api_keys")


# --- JobRow ---------------------------------------------------------------


class JobRow(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_user_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    visibility: Mapped[str] = mapped_column(String, default="private")
    pdf_path: Mapped[str] = mapped_column(String)
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_mode: Mapped[str] = mapped_column(String, default="pdf")
    content_domain: Mapped[str] = mapped_column(String, default="general")
    auto_review: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    claims_total: Mapped[int] = mapped_column(Integer, default=0)
    claims_audited: Mapped[int] = mapped_column(Integer, default=0)
    audit_report_md: Mapped[str | None] = mapped_column(String, nullable=True)
    stages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)

    owner: Mapped[UserRow | None] = relationship(back_populates="jobs")
    claims: Mapped[list[ClaimRow]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    findings: Mapped[list[FindingRow]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    traces: Mapped[list[ReasoningTraceRow]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    evidences: Mapped[list[EvidenceRow]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    @classmethod
    def from_domain(
        cls,
        m: Job,
        *,
        owner_user_id: str | None = None,
        visibility: str = "private",
    ) -> JobRow:
        return cls(
            id=m.id,
            owner_user_id=owner_user_id,
            visibility=visibility,
            pdf_path=m.pdf_path,
            input_text=m.input_text,
            input_mode=m.input_mode,
            content_domain=m.content_domain.value,
            auto_review=m.auto_review,
            status=m.status,
            created_at=m.created_at,
            completed_at=m.completed_at,
            cost_usd=m.cost_usd,
            total_tokens=m.total_tokens,
            claims_total=m.claims_total,
            claims_audited=m.claims_audited,
            audit_report_md=m.audit_report_md,
            stages=[s.model_dump() for s in m.stages],
            claims=[ClaimRow.from_domain(c, job_id=m.id) for c in m.claims],
            findings=[FindingRow.from_domain(f) for f in m.findings],
            traces=[ReasoningTraceRow.from_domain(t) for t in m.traces],
            evidences=[EvidenceRow.from_domain(e, job_id=m.id) for e in m.evidences],
        )

    def to_domain(self) -> Job:
        return Job(
            id=self.id,
            pdf_path=self.pdf_path,
            input_text=self.input_text,
            input_mode=self.input_mode or "pdf",
            content_domain=self.content_domain or "general",
            auto_review=bool(self.auto_review),
            status=self.status,
            created_at=self.created_at,
            completed_at=self.completed_at,
            cost_usd=self.cost_usd,
            total_tokens=self.total_tokens,
            claims_total=self.claims_total or 0,
            claims_audited=self.claims_audited or 0,
            audit_report_md=self.audit_report_md,
            stages=[Stage.model_validate(s) for s in (self.stages or [])],
            claims=[c.to_domain() for c in self.claims],
            findings=[f.to_domain() for f in self.findings],
            traces=[t.to_domain() for t in self.traces],
            evidences=[e.to_domain() for e in self.evidences],
        )


# --- ClaimRow -------------------------------------------------------------


class ClaimRow(Base):
    __tablename__ = "claims"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"))
    text: Mapped[str] = mapped_column(String)
    page: Mapped[int] = mapped_column(Integer)
    span: Mapped[list[int]] = mapped_column(JSON)
    type: Mapped[str] = mapped_column(String)
    importance: Mapped[str] = mapped_column(String)
    extracted_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    job: Mapped[JobRow] = relationship(back_populates="claims")

    @classmethod
    def from_domain(cls, m: Claim, *, job_id: str) -> ClaimRow:
        return cls(
            id=m.id,
            job_id=job_id,
            text=m.text,
            page=m.page,
            span=list(m.span),
            type=m.type.value,
            importance=m.importance,
            extracted_metadata=m.extracted_metadata,
        )

    def to_domain(self) -> Claim:
        start, end = self.span
        return Claim(
            id=self.id,
            text=self.text,
            page=self.page,
            span=(int(start), int(end)),
            type=ClaimType(self.type),
            importance=self.importance,
            extracted_metadata=self.extracted_metadata or {},
        )


# --- FindingRow -----------------------------------------------------------


class FindingRow(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"))
    claim_id: Mapped[str] = mapped_column(String)
    agent: Mapped[str] = mapped_column(String)
    verdict: Mapped[str] = mapped_column(String)
    severity: Mapped[str] = mapped_column(String)
    confidence: Mapped[float] = mapped_column(Float)
    confidence_breakdown: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str] = mapped_column(String)
    evidence_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    reasoning_trace_id: Mapped[str] = mapped_column(String)
    related_finding_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    why_wrong: Mapped[str | None] = mapped_column(String, nullable=True)
    correct_info_value: Mapped[str | None] = mapped_column(String, nullable=True)
    correct_info_source: Mapped[str | None] = mapped_column(String, nullable=True)
    correct_info_url: Mapped[str | None] = mapped_column(String, nullable=True)
    correct_info_retrieved_date: Mapped[str | None] = mapped_column(String, nullable=True)
    evidence_quality: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    coverage: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    skeptic_review: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    computation_check: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    job: Mapped[JobRow] = relationship(back_populates="findings")

    @classmethod
    def from_domain(cls, m: Finding) -> FindingRow:
        return cls(
            id=m.id,
            job_id=m.job_id,
            claim_id=m.claim_id,
            agent=m.agent,
            verdict=m.verdict.value,
            severity=m.severity.value,
            confidence=m.confidence,
            confidence_breakdown=(
                m.confidence_breakdown.model_dump() if m.confidence_breakdown else None
            ),
            summary=m.summary,
            evidence_ids=list(m.evidence_ids),
            reasoning_trace_id=m.reasoning_trace_id,
            related_finding_ids=list(m.related_finding_ids),
            created_at=m.created_at,
            why_wrong=m.why_wrong,
            correct_info_value=m.correct_information.value if m.correct_information else None,
            correct_info_source=m.correct_information.source if m.correct_information else None,
            correct_info_url=m.correct_information.url if m.correct_information else None,
            correct_info_retrieved_date=(
                m.correct_information.retrieved_date if m.correct_information else None
            ),
            evidence_quality=[q.model_dump() for q in m.evidence_quality],
            coverage=[c.model_dump() for c in m.coverage],
            skeptic_review=(
                m.skeptic_review.model_dump() if m.skeptic_review else None
            ),
            computation_check=(
                m.computation_check.model_dump() if m.computation_check else None
            ),
        )

    def to_domain(self) -> Finding:
        corrected = None
        if self.correct_info_value is not None:
            corrected = CorrectedInfo(
                value=self.correct_info_value,
                source=self.correct_info_source or "",
                url=self.correct_info_url,
                retrieved_date=self.correct_info_retrieved_date,
            )
        return Finding(
            id=self.id,
            job_id=self.job_id,
            claim_id=self.claim_id,
            agent=self.agent,
            verdict=FindingVerdict(self.verdict),
            severity=Severity(self.severity),
            confidence=self.confidence,
            confidence_breakdown=(
                ConfidenceBreakdown(**self.confidence_breakdown)
                if self.confidence_breakdown
                else None
            ),
            summary=self.summary,
            evidence_ids=list(self.evidence_ids or []),
            reasoning_trace_id=self.reasoning_trace_id,
            related_finding_ids=list(self.related_finding_ids or []),
            created_at=self.created_at,
            why_wrong=self.why_wrong,
            correct_information=corrected,
            evidence_quality=[
                EvidenceQuality.model_validate(q) for q in (self.evidence_quality or [])
            ],
            coverage=[
                ClaimCoverage.model_validate(c) for c in (self.coverage or [])
            ],
            skeptic_review=(
                SkepticReview.model_validate(self.skeptic_review)
                if self.skeptic_review
                else None
            ),
            computation_check=(
                ComputationCheck.model_validate(self.computation_check)
                if self.computation_check
                else None
            ),
        )


# --- ReasoningTraceRow + StepRow -----------------------------------------


class ReasoningTraceRow(Base):
    __tablename__ = "traces"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"))
    claim_id: Mapped[str] = mapped_column(String)
    agent: Mapped[str] = mapped_column(String)
    miromind_response_id: Mapped[str] = mapped_column(String)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, default=0)
    num_search_queries: Mapped[int] = mapped_column(Integer, default=0)
    final_verdict_step_id: Mapped[str | None] = mapped_column(String, nullable=True)

    job: Mapped[JobRow] = relationship(back_populates="traces")
    steps: Mapped[list[StepRow]] = relationship(
        back_populates="trace",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="StepRow.sequence",
    )

    @classmethod
    def from_domain(cls, m: ReasoningTrace) -> ReasoningTraceRow:
        return cls(
            id=m.id,
            job_id=m.job_id,
            claim_id=m.claim_id,
            agent=m.agent,
            miromind_response_id=m.miromind_response_id,
            started_at=m.started_at,
            completed_at=m.completed_at,
            total_tokens=m.total_tokens,
            reasoning_tokens=m.reasoning_tokens,
            num_search_queries=m.num_search_queries,
            final_verdict_step_id=m.final_verdict_step_id,
            steps=[StepRow.from_domain(s) for s in m.steps],
        )

    def to_domain(self) -> ReasoningTrace:
        return ReasoningTrace(
            id=self.id,
            job_id=self.job_id,
            claim_id=self.claim_id,
            agent=self.agent,
            miromind_response_id=self.miromind_response_id,
            started_at=self.started_at,
            completed_at=self.completed_at,
            total_tokens=self.total_tokens,
            reasoning_tokens=self.reasoning_tokens,
            num_search_queries=self.num_search_queries,
            final_verdict_step_id=self.final_verdict_step_id,
            steps=[s.to_domain() for s in self.steps],
        )


class StepRow(Base):
    __tablename__ = "steps"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    trace_id: Mapped[str] = mapped_column(String, ForeignKey("traces.id"))
    sequence: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String)
    summary: Mapped[str] = mapped_column(String)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    evidence_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    parent_step_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    trace: Mapped[ReasoningTraceRow] = relationship(back_populates="steps")

    @classmethod
    def from_domain(cls, m: Step) -> StepRow:
        return cls(
            id=m.id,
            trace_id=m.trace_id,
            sequence=m.sequence,
            type=m.type.value,
            summary=m.summary,
            content=m.content,
            evidence_ids=list(m.evidence_ids),
            parent_step_id=m.parent_step_id,
            created_at=m.created_at,
        )

    def to_domain(self) -> Step:
        return Step(
            id=self.id,
            trace_id=self.trace_id,
            sequence=self.sequence,
            type=StepType(self.type),
            summary=self.summary,
            content=self.content or {},
            evidence_ids=list(self.evidence_ids or []),
            parent_step_id=self.parent_step_id,
            created_at=self.created_at,
        )


# --- EvidenceRow ----------------------------------------------------------


class FindingCacheRow(Base):
    __tablename__ = "finding_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload: Mapped[str] = mapped_column(JSON, nullable=False)
    verifier_version: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    content_domain: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)


class EvidenceRow(Base):
    __tablename__ = "evidences"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"))
    source_type: Mapped[str] = mapped_column(String)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    citation: Mapped[str] = mapped_column(String)
    snippet: Mapped[str] = mapped_column(String, default="")
    full_content_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    retrieved_by_step_id: Mapped[str] = mapped_column(String)

    job: Mapped[JobRow] = relationship(back_populates="evidences")

    @classmethod
    def from_domain(cls, m: Evidence, *, job_id: str) -> EvidenceRow:
        return cls(
            id=m.id,
            job_id=job_id,
            source_type=m.source_type.value,
            url=m.url,
            citation=m.citation,
            snippet=m.snippet,
            full_content_ref=m.full_content_ref,
            retrieved_at=m.retrieved_at,
            retrieved_by_step_id=m.retrieved_by_step_id,
        )

    def to_domain(self) -> Evidence:
        return Evidence(
            id=self.id,
            source_type=EvidenceSource(self.source_type),
            url=self.url,
            citation=self.citation,
            snippet=self.snippet,
            full_content_ref=self.full_content_ref,
            retrieved_at=self.retrieved_at,
            retrieved_by_step_id=self.retrieved_by_step_id,
        )
