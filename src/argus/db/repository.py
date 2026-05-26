"""Repository for Job persistence — the single domain ↔ DB boundary."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from argus.db.models import JobRow
from argus.models.domain import Job


class JobRepository:
    """High-level Job persistence built on JobRow."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._smaker = session_factory

    @property
    def sessionmaker(self) -> async_sessionmaker[AsyncSession]:
        """Public accessor for plugging into auxiliary caches/services."""
        return self._smaker

    async def save_job(self, job: Job) -> None:
        """Upsert a Job + all its nested rows.

        We fetch any existing JobRow with the same id and use
        ``session.delete()`` so the ORM-level cascade fires (deleting
        nested claims/findings/traces/steps/evidences); then insert the
        new tree. Partial-job updates aren't a real use case for Argus —
        a job either runs to completion or aborts — so wiping-and-
        reinserting is simpler and correctness-safe than diffing nested
        collections.
        """
        async with self._smaker() as session, session.begin():
            existing = (
                await session.execute(select(JobRow).where(JobRow.id == job.id))
            ).scalar_one_or_none()
            if existing is not None:
                await session.delete(existing)
                await session.flush()
            session.add(JobRow.from_domain(job))

    async def get_job(self, job_id: str) -> Job | None:
        async with self._smaker() as session:
            row = (
                await session.execute(select(JobRow).where(JobRow.id == job_id))
            ).scalar_one_or_none()
            if row is None:
                return None
            return row.to_domain()

    async def mark_running_as_interrupted(self) -> int:
        """Flip any job in 'running' state to 'interrupted'.

        Called on startup — any job marked 'running' was abandoned by a
        crashed/killed worker. Returns the number of jobs flipped.
        """
        from sqlalchemy import update

        async with self._smaker() as session:
            result = await session.execute(
                update(JobRow)
                .where(JobRow.status == "running")
                .values(status="interrupted")
            )
            await session.commit()
            # CursorResult exposes rowcount; cast for mypy since execute() is
            # typed as Result[Any] generically.
            return int(getattr(result, "rowcount", 0) or 0)

    async def list_jobs(self, *, limit: int = 20) -> list[Job]:
        async with self._smaker() as session:
            stmt = select(JobRow).order_by(JobRow.created_at.desc()).limit(limit)
            rows = (await session.execute(stmt)).scalars().all()
            return [r.to_domain() for r in rows]
