"""Repository for Job persistence — the single domain ↔ DB boundary."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from argus.db.models import (
    AnalyticsEventRow,
    AuditAccessLogRow,
    AuditShareLinkRow,
    JobRow,
    UserApiKeyRow,
    UserRow,
)
from argus.models.domain import Job


class UserIdentity(Protocol):
    id: str
    email: str | None
    name: str | None
    avatar_url: str | None


@dataclass(frozen=True)
class JobSummary:
    id: str
    status: str
    input_mode: str
    title: str
    created_at: datetime
    completed_at: datetime | None
    findings_count: int
    claims_total: int
    claims_audited: int
    cost_usd: float
    share_links: list[ShareLinkSummary]


@dataclass(frozen=True)
class ApiKeySummary:
    id: str
    provider: str
    label: str
    fingerprint: str
    last4: str
    is_default: bool
    created_at: datetime
    last_used_at: datetime | None


@dataclass(frozen=True)
class ShareLinkSummary:
    token: str
    job_id: str
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None


class JobRepository:
    """High-level Job persistence built on JobRow."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._smaker = session_factory

    @property
    def sessionmaker(self) -> async_sessionmaker[AsyncSession]:
        """Public accessor for plugging into auxiliary caches/services."""
        return self._smaker

    async def save_job(self, job: Job, *, owner_user_id: str | None = None) -> None:
        """Upsert a Job + all its nested rows.

        We fetch any existing JobRow with the same id and use
        ``session.delete()`` so the ORM-level cascade fires (deleting
        nested claims/findings/traces/steps/evidences); then insert the
        new tree. Partial-job updates aren't a real use case for Argus —
        a job either runs to completion or aborts — so wiping-and-
        reinserting is simpler and correctness-safe than diffing nested
        collections. If ``owner_user_id`` is omitted, preserve the existing
        owner on upsert so the orchestrator can persist final results without
        knowing about request-level auth.
        """
        async with self._smaker() as session, session.begin():
            existing = (
                await session.execute(select(JobRow).where(JobRow.id == job.id))
            ).scalar_one_or_none()
            preserved_owner = owner_user_id
            preserved_visibility = "private"
            if existing is not None:
                preserved_owner = (
                    owner_user_id if owner_user_id is not None else existing.owner_user_id
                )
                preserved_visibility = existing.visibility or "private"
                await session.delete(existing)
                await session.flush()
            session.add(
                JobRow.from_domain(
                    job,
                    owner_user_id=preserved_owner,
                    visibility=preserved_visibility,
                )
            )

    async def get_job(self, job_id: str) -> Job | None:
        async with self._smaker() as session:
            row = (
                await session.execute(select(JobRow).where(JobRow.id == job_id))
            ).scalar_one_or_none()
            if row is None:
                return None
            return row.to_domain()

    async def get_job_for_user(self, job_id: str, owner_user_id: str) -> Job | None:
        async with self._smaker() as session:
            row = (
                await session.execute(
                    select(JobRow).where(
                        JobRow.id == job_id,
                        JobRow.owner_user_id == owner_user_id,
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            return row.to_domain()

    async def get_job_owner(self, job_id: str) -> str | None:
        async with self._smaker() as session:
            row = (
                await session.execute(select(JobRow.owner_user_id).where(JobRow.id == job_id))
            ).scalar_one_or_none()
            return row

    async def delete_job_for_user(self, *, job_id: str, owner_user_id: str) -> bool:
        async with self._smaker() as session, session.begin():
            row = (
                await session.execute(
                    select(JobRow).where(
                        JobRow.id == job_id,
                        JobRow.owner_user_id == owner_user_id,
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            await session.execute(
                delete(AuditAccessLogRow).where(AuditAccessLogRow.job_id == job_id)
            )
            await session.execute(
                delete(AuditShareLinkRow).where(AuditShareLinkRow.job_id == job_id)
            )
            await session.delete(row)
            return True

    async def mark_running_as_interrupted(self) -> int:
        """Flip any unfinished job state to 'interrupted'.

        Called on startup — any job in an active pipeline state was abandoned
        by a crashed/killed worker. Returns the number of jobs flipped.
        """
        active_statuses = [
            "queued",
            "running",
            "parsing",
            "planning",
            "atomizing",
            "filtering",
            "reviewing",
            "verifying",
            "reporting",
        ]
        async with self._smaker() as session:
            result = await session.execute(
                update(JobRow)
                .where(JobRow.status.in_(active_statuses))
                .values(status="interrupted")
            )
            await session.commit()
            # CursorResult exposes rowcount; cast for mypy since execute() is
            # typed as Result[Any] generically.
            return int(getattr(result, "rowcount", 0) or 0)

    async def list_jobs(self, *, limit: int = 20, owner_user_id: str | None = None) -> list[Job]:
        async with self._smaker() as session:
            stmt = select(JobRow).order_by(JobRow.created_at.desc()).limit(limit)
            if owner_user_id is not None:
                stmt = stmt.where(JobRow.owner_user_id == owner_user_id)
            rows = (await session.execute(stmt)).scalars().all()
            return [r.to_domain() for r in rows]

    async def list_job_summaries(
        self,
        *,
        owner_user_id: str,
        limit: int = 50,
    ) -> list[JobSummary]:
        async with self._smaker() as session:
            now = datetime.utcnow()
            rows = (
                await session.execute(
                    select(JobRow)
                    .options(
                        selectinload(JobRow.findings),
                        selectinload(JobRow.share_links),
                    )
                    .where(JobRow.owner_user_id == owner_user_id)
                    .order_by(JobRow.created_at.desc())
                    .limit(limit)
                )
            ).scalars().all()
            return [
                JobSummary(
                    id=row.id,
                    status=row.status,
                    input_mode=row.input_mode or "pdf",
                    title=_job_title(row),
                    created_at=row.created_at,
                    completed_at=row.completed_at,
                    findings_count=len(row.findings),
                    claims_total=row.claims_total or 0,
                    claims_audited=row.claims_audited or 0,
                    cost_usd=row.cost_usd,
                    share_links=[
                        _share_link_summary(link)
                        for link in row.share_links
                        if link.revoked_at is None
                        and (link.expires_at is None or link.expires_at > now)
                    ],
                )
                for row in rows
            ]

    async def upsert_user(self, user: UserIdentity) -> None:
        async with self._smaker() as session, session.begin():
            row = (
                await session.execute(select(UserRow).where(UserRow.id == user.id))
            ).scalar_one_or_none()
            now = datetime.utcnow()
            if row is None:
                row = UserRow(
                    id=user.id,
                    email=user.email or "",
                    name=user.name,
                    avatar_url=user.avatar_url,
                    created_at=now,
                    last_seen_at=now,
                )
                session.add(row)
                return
            row.email = user.email or row.email
            row.name = user.name
            row.avatar_url = user.avatar_url
            row.last_seen_at = now

    async def create_api_key(
        self,
        *,
        user_id: str,
        encrypted_key: str,
        fingerprint: str,
        last4: str,
        label: str = "MiroMind API key",
        provider: str = "miromind",
        make_default: bool = True,
    ) -> ApiKeySummary:
        async with self._smaker() as session, session.begin():
            if make_default:
                await session.execute(
                    update(UserApiKeyRow)
                    .where(
                        UserApiKeyRow.user_id == user_id,
                        UserApiKeyRow.provider == provider,
                        UserApiKeyRow.revoked_at.is_(None),
                    )
                    .values(is_default=False)
                )
            now = datetime.utcnow()
            row = UserApiKeyRow(
                id=f"key_{uuid4().hex[:12]}",
                user_id=user_id,
                provider=provider,
                label=label.strip() or "MiroMind API key",
                encrypted_key=encrypted_key,
                fingerprint=fingerprint,
                last4=last4,
                is_default=make_default,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            return _api_key_summary(row)

    async def list_api_keys(
        self,
        *,
        user_id: str,
        provider: str = "miromind",
    ) -> list[ApiKeySummary]:
        async with self._smaker() as session:
            rows = (
                await session.execute(
                    select(UserApiKeyRow)
                    .where(
                        UserApiKeyRow.user_id == user_id,
                        UserApiKeyRow.provider == provider,
                        UserApiKeyRow.revoked_at.is_(None),
                    )
                    .order_by(UserApiKeyRow.is_default.desc(), UserApiKeyRow.created_at.desc())
                )
            ).scalars().all()
            return [_api_key_summary(row) for row in rows]

    async def get_api_key_ciphertext(
        self,
        *,
        user_id: str,
        key_id: str | None = None,
        provider: str = "miromind",
    ) -> tuple[str, str] | None:
        async with self._smaker() as session:
            stmt = select(UserApiKeyRow).where(
                UserApiKeyRow.user_id == user_id,
                UserApiKeyRow.provider == provider,
                UserApiKeyRow.revoked_at.is_(None),
            )
            if key_id is not None:
                stmt = stmt.where(UserApiKeyRow.id == key_id)
            else:
                stmt = stmt.where(UserApiKeyRow.is_default.is_(True)).order_by(
                    UserApiKeyRow.created_at.desc()
                )
            row = (await session.execute(stmt.limit(1))).scalar_one_or_none()
            if row is None:
                return None
            row.last_used_at = datetime.utcnow()
            await session.commit()
            return row.encrypted_key, row.id

    async def get_api_key_ciphertext_by_id(
        self,
        *,
        user_id: str,
        key_id: str,
        provider: str = "miromind",
    ) -> str | None:
        async with self._smaker() as session:
            row = (
                await session.execute(
                    select(UserApiKeyRow).where(
                        UserApiKeyRow.id == key_id,
                        UserApiKeyRow.user_id == user_id,
                        UserApiKeyRow.provider == provider,
                        UserApiKeyRow.revoked_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            return row.encrypted_key if row is not None else None

    async def update_api_key(
        self,
        *,
        user_id: str,
        key_id: str,
        label: str | None = None,
        make_default: bool | None = None,
        provider: str = "miromind",
    ) -> ApiKeySummary | None:
        async with self._smaker() as session, session.begin():
            row = (
                await session.execute(
                    select(UserApiKeyRow).where(
                        UserApiKeyRow.id == key_id,
                        UserApiKeyRow.user_id == user_id,
                        UserApiKeyRow.provider == provider,
                        UserApiKeyRow.revoked_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            if label is not None:
                row.label = label.strip() or "MiroMind API key"
            if make_default:
                await session.execute(
                    update(UserApiKeyRow)
                    .where(
                        UserApiKeyRow.user_id == user_id,
                        UserApiKeyRow.provider == provider,
                        UserApiKeyRow.revoked_at.is_(None),
                    )
                    .values(is_default=False)
                )
                row.is_default = True
            row.updated_at = datetime.utcnow()
            return _api_key_summary(row)

    async def revoke_api_key(self, *, user_id: str, key_id: str) -> bool:
        async with self._smaker() as session:
            row = (
                await session.execute(
                    select(UserApiKeyRow).where(
                        UserApiKeyRow.id == key_id,
                        UserApiKeyRow.user_id == user_id,
                        UserApiKeyRow.revoked_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            row.revoked_at = datetime.utcnow()
            row.is_default = False
            await session.commit()
            return True

    async def create_share_link(
        self,
        *,
        job_id: str,
        owner_user_id: str,
        token: str,
        expires_at: datetime | None,
    ) -> ShareLinkSummary | None:
        async with self._smaker() as session, session.begin():
            job_exists = (
                await session.execute(
                    select(JobRow.id).where(
                        JobRow.id == job_id,
                        JobRow.owner_user_id == owner_user_id,
                    )
                )
            ).scalar_one_or_none()
            if job_exists is None:
                return None
            row = AuditShareLinkRow(
                token=token,
                job_id=job_id,
                owner_user_id=owner_user_id,
                created_at=datetime.utcnow(),
                expires_at=expires_at,
            )
            session.add(row)
            return _share_link_summary(row)

    async def revoke_share_link(
        self,
        *,
        job_id: str,
        owner_user_id: str,
        token: str,
    ) -> bool:
        async with self._smaker() as session, session.begin():
            row = (
                await session.execute(
                    select(AuditShareLinkRow).where(
                        AuditShareLinkRow.token == token,
                        AuditShareLinkRow.job_id == job_id,
                        AuditShareLinkRow.owner_user_id == owner_user_id,
                        AuditShareLinkRow.revoked_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            row.revoked_at = datetime.utcnow()
            return True

    async def get_job_by_share_token(self, token: str) -> Job | None:
        async with self._smaker() as session, session.begin():
            now = datetime.utcnow()
            link = (
                await session.execute(
                    select(AuditShareLinkRow).where(
                        AuditShareLinkRow.token == token,
                        AuditShareLinkRow.revoked_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if link is None:
                return None
            if link.expires_at is not None and link.expires_at < now:
                return None
            row = (
                await session.execute(select(JobRow).where(JobRow.id == link.job_id))
            ).scalar_one_or_none()
            if row is None:
                return None
            link.last_accessed_at = now
            session.add(
                AuditAccessLogRow(
                    id=f"log_{uuid4().hex[:12]}",
                    job_id=link.job_id,
                    user_id=None,
                    actor_type="share_link",
                    action="view",
                    created_at=now,
                    access_metadata={"token": token[:8]},
                )
            )
            return row.to_domain()

    async def log_job_access(
        self,
        *,
        job_id: str,
        user_id: str | None,
        actor_type: str,
        action: str = "view",
        metadata: dict[str, object] | None = None,
    ) -> None:
        async with self._smaker() as session, session.begin():
            session.add(
                AuditAccessLogRow(
                    id=f"log_{uuid4().hex[:12]}",
                    job_id=job_id,
                    user_id=user_id,
                    actor_type=actor_type,
                    action=action,
                    created_at=datetime.utcnow(),
                    access_metadata=dict(metadata or {}),
                )
            )

    async def record_event(
        self,
        *,
        event_name: str,
        user_id: str | None,
        path: str | None,
        properties: dict[str, object] | None = None,
    ) -> None:
        async with self._smaker() as session, session.begin():
            session.add(
                AnalyticsEventRow(
                    id=f"evt_{uuid4().hex[:12]}",
                    user_id=user_id,
                    event_name=event_name,
                    path=path,
                    properties=dict(properties or {}),
                    created_at=datetime.utcnow(),
                )
            )

    async def delete_user_data(self, *, user_id: str) -> None:
        async with self._smaker() as session, session.begin():
            job_ids = (
                await session.execute(select(JobRow.id).where(JobRow.owner_user_id == user_id))
            ).scalars().all()
            if job_ids:
                await session.execute(
                    delete(AuditAccessLogRow).where(AuditAccessLogRow.job_id.in_(job_ids))
                )
                await session.execute(
                    delete(AuditShareLinkRow).where(AuditShareLinkRow.job_id.in_(job_ids))
                )
                rows = (
                    await session.execute(select(JobRow).where(JobRow.id.in_(job_ids)))
                ).scalars().all()
                for row in rows:
                    await session.delete(row)
            await session.execute(
                delete(AnalyticsEventRow).where(AnalyticsEventRow.user_id == user_id)
            )
            await session.execute(
                delete(AuditAccessLogRow).where(AuditAccessLogRow.user_id == user_id)
            )
            await session.execute(delete(UserApiKeyRow).where(UserApiKeyRow.user_id == user_id))
            await session.execute(
                delete(AuditShareLinkRow).where(AuditShareLinkRow.owner_user_id == user_id)
            )
            user = (
                await session.execute(select(UserRow).where(UserRow.id == user_id))
            ).scalar_one_or_none()
            if user is not None:
                await session.delete(user)


def _job_title(row: JobRow) -> str:
    if row.input_mode == "text" and row.input_text:
        compact = " ".join(row.input_text.strip().split())
        return compact[:96] + ("..." if len(compact) > 96 else "")
    if row.pdf_path:
        return row.pdf_path.rsplit("/", 1)[-1] or row.id
    return row.id


def _api_key_summary(row: UserApiKeyRow) -> ApiKeySummary:
    return ApiKeySummary(
        id=row.id,
        provider=row.provider,
        label=row.label,
        fingerprint=row.fingerprint,
        last4=row.last4,
        is_default=bool(row.is_default),
        created_at=row.created_at,
        last_used_at=row.last_used_at,
    )


def _share_link_summary(row: AuditShareLinkRow) -> ShareLinkSummary:
    return ShareLinkSummary(
        token=row.token,
        job_id=row.job_id,
        created_at=row.created_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
    )
