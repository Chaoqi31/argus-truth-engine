"""SQLAlchemy 2.0 async declarative models.

An audit is one `jobs` row: the whole `Job` as a JSON document plus the
columns the history list and access checks query. The aggregate is only ever
loaded and saved whole, so a document round-trips every field by construction.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from argus.models.domain import Job


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
    share_links: Mapped[list[AuditShareLinkRow]] = relationship(
        back_populates="owner",
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


class AuditShareLinkRow(Base):
    __tablename__ = "audit_share_links"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"), index=True)
    owner_user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    job: Mapped[JobRow] = relationship(back_populates="share_links")
    owner: Mapped[UserRow] = relationship(back_populates="share_links")


class AuditAccessLogRow(Base):
    __tablename__ = "audit_access_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    actor_type: Mapped[str] = mapped_column(String, default="user")
    action: Mapped[str] = mapped_column(String, default="view")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    access_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AnalyticsEventRow(Base):
    __tablename__ = "analytics_events"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    event_name: Mapped[str] = mapped_column(String, index=True)
    path: Mapped[str | None] = mapped_column(String, nullable=True)
    properties: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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
    status: Mapped[str] = mapped_column(String, index=True)
    input_mode: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float)
    findings_count: Mapped[int] = mapped_column(Integer)
    claims_total: Mapped[int] = mapped_column(Integer)
    claims_audited: Mapped[int] = mapped_column(Integer)
    document: Mapped[str] = mapped_column(Text)

    owner: Mapped[UserRow | None] = relationship(back_populates="jobs")
    share_links: Mapped[list[AuditShareLinkRow]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def write(self, job: Job) -> None:
        """Store `job` and recompute every queryable column from it."""
        self.status = job.status
        self.input_mode = job.input_mode
        self.title = _title(job)
        self.created_at = job.created_at
        self.completed_at = job.completed_at
        self.cost_usd = job.cost_usd
        self.findings_count = len(job.findings)
        self.claims_total = job.claims_total
        self.claims_audited = job.claims_audited
        self.document = job.document_json()

    def job(self) -> Job:
        return Job.model_validate_json(self.document)


def _title(job: Job) -> str:
    if job.input_mode == "text" and job.input_text:
        compact = " ".join(job.input_text.split())
        return compact[:96] + ("..." if len(compact) > 96 else "")
    return job.pdf_path.rsplit("/", 1)[-1] or job.id


# --- FindingCacheRow ------------------------------------------------------


class FindingCacheRow(Base):
    __tablename__ = "finding_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    verifier_version: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    content_domain: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
