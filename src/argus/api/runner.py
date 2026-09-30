"""The API's in-process job runner: the one way to start, watch, and stop audits.

It owns the live runs (job id -> `Run` and its task), bounded by
`max_active_jobs`, and each job's subscribers, who stay subscribed across
runs: a client watching a job paused for review receives the frames of the
run that resumes it. A job is stored when it is submitted and whenever a run
of it ends (paused, done, failed, cancelled), never per event.

Everything that must happen atomically (the capacity check and the start,
the snapshot and the subscription, an event and its fan-out) happens without
an await in between, on the one event loop, so there are no locks.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Collection
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime

from argus.audit import Run, extract, verify
from argus.cache.finding_cache import FindingCache
from argus.config import Settings
from argus.db.repository import JobRepository
from argus.llm import Transports
from argus.llm.miromind import MiroMindAccess
from argus.log import log
from argus.models.job import (
    EventFrame,
    Failure,
    FailureKind,
    Finished,
    Job,
    SnapshotFrame,
)

# A frame a client must not see before the job is stored. It carries the state
# everything else reads from the database, and it is the run's last, so holding
# it reorders nothing. The pause is not held: a client that answers on it is
# waiting in `select`, and holding it would let the run's own next frame past.
_HELD_UNTIL_STORED = frozenset({"finished"})

# Frames a subscriber may fall behind by before it is dropped; its client
# reconnects and starts again from a snapshot.
_BACKLOG = 2000


class CapacityError(Exception):
    """Too many live runs."""


class JobBusy(Exception):
    """A run of this job is already live."""


class JobNotFound(Exception):
    pass


@dataclass(frozen=True)
class _Live:
    run: Run
    task: asyncio.Task[None]
    # Frames this run recorded that wait for its job to be stored.
    held: list[EventFrame]


class Feed:
    """One subscription: the job as it was when it began, then every frame
    applied after it, in order."""

    def __init__(self, job: Job, queue: asyncio.Queue[EventFrame | None]) -> None:
        self.snapshot_json = SnapshotFrame(job=job).model_dump_json()
        self.version = job.version
        self.terminal = job.status in ("done", "failed")
        self._queue = queue

    async def frames(self) -> AsyncIterator[EventFrame]:
        """Frames after the snapshot. Ends when the subscriber falls too far
        behind."""
        while (frame := await self._queue.get()) is not None:
            if frame.version > self.version:
                yield frame


class Runner:
    def __init__(self, *, repo: JobRepository, transports: Transports, settings: Settings) -> None:
        self._repo = repo
        self._transports = transports
        self._settings = settings
        self._cache = (
            FindingCache(
                repo.sessionmaker,
                default_ttl_days=settings.cache_ttl_days,
                time_sensitive_ttl_days=settings.cache_ttl_time_sensitive_days,
            )
            if settings.cache_enabled
            else None
        )
        self._live: dict[str, _Live] = {}
        self._reserved = 0
        self._subscribers: dict[str, set[asyncio.Queue[EventFrame | None]]] = {}

    async def recover(self) -> None:
        """At startup: a job stored as running belonged to a process that
        died. It ends failed; a job paused for review keeps waiting."""
        for job in await self._repo.running_jobs():
            job.apply(
                Finished(
                    status="failed",
                    failure=Failure(
                        kind=FailureKind.INTERRUPTED,
                        message="The server restarted while this audit was running.",
                    ),
                    completed_at=datetime.utcnow(),
                )
            )
            await self._repo.update_job(job)
            log.info("runner.interrupted_run_failed", job_id=job.id)

    async def shutdown(self) -> None:
        """Stop every live run. Each ends its job failed and stores it, so
        what a run found before the shutdown is kept."""
        tasks = [live.task for live in self._live.values()]
        for task in tasks:
            task.cancel("The server shut down while this audit was running.")
        await asyncio.gather(*tasks, return_exceptions=True)

    async def submit(
        self, job: Job, *, access: MiroMindAccess, owner_user_id: str | None
    ) -> None:
        """Store a new job and start auditing it. Raises `CapacityError`,
        having stored nothing, when too many runs are live."""
        self.check_capacity()
        self._reserved += 1
        try:
            await self._repo.save_job(job, owner_user_id=owner_user_id)
        finally:
            self._reserved -= 1
        self._start(job, access, _audit)

    async def select(
        self, job_id: str, claim_ids: Collection[str], *, access: MiroMindAccess
    ) -> None:
        """Verify the claims the reviewer kept on a job paused for review.
        Raises `JobNotFound`, `NotAwaitingReview`, `UnknownClaims`, `JobBusy`,
        or `CapacityError`."""
        live = self._live.get(job_id)
        if live is not None:
            if live.run.job.status != "awaiting_review":
                raise JobBusy(job_id)
            # The run paused and is storing its job. Its `review_ready` frame
            # reached the client before that write, so a reviewer who answers
            # at once waits here rather than reading the run's earlier state.
            await asyncio.gather(live.task, return_exceptions=True)
        job = await self._repo.get_job(job_id)
        if job is None:
            raise JobNotFound(job_id)
        job.check_selection(claim_ids)
        self.check_capacity()

        async def selected(run: Run) -> None:
            await verify(run, claim_ids)

        self._start(job, access, selected)

    async def cancel(self, job_id: str) -> None:
        """Stop a live run of the job, if there is one, and wait until its
        job is stored."""
        live = self._live.get(job_id)
        if live is None:
            return
        live.task.cancel("The audit was deleted.")
        await asyncio.gather(live.task, return_exceptions=True)

    async def get(self, job_id: str) -> Job | None:
        """The job as it is now: the live run's while one is live, else the
        stored one."""
        live = self._live.get(job_id)
        if live is not None:
            return live.run.job
        return await self._repo.get_job(job_id)

    @asynccontextmanager
    async def subscribe(self, job_id: str) -> AsyncIterator[Feed]:
        """Raises `JobNotFound`."""
        queue: asyncio.Queue[EventFrame | None] = asyncio.Queue()
        subscribers = self._subscribers.setdefault(job_id, set())
        subscribers.add(queue)
        try:
            live = self._live.get(job_id)
            # Loading the stored job awaits, and a run may start meanwhile:
            # its frames queue up, and the feed skips those the job already has.
            job = live.run.job if live is not None else await self._repo.get_job(job_id)
            if job is None:
                raise JobNotFound(job_id)
            yield Feed(job, queue)
        finally:
            subscribers.discard(queue)
            if not subscribers:
                self._subscribers.pop(job_id, None)

    def check_capacity(self) -> None:
        """Raises `CapacityError` when no more runs may start."""
        if len(self._live) + self._reserved >= self._settings.max_active_jobs:
            raise CapacityError("Too many active audits; try again later.")

    def _start(
        self, job: Job, access: MiroMindAccess, work: Callable[[Run], Awaitable[None]]
    ) -> None:
        run = Run(
            job,
            llm=self._transports.for_job(access),
            cache=self._cache,
            settings=self._settings,
            budget_usd=self._settings.job_budget_usd,
            emit=lambda frame: self._fan_out(job.id, frame),
        )
        held: list[EventFrame] = []
        task = asyncio.create_task(self._drive(run, work, held), name=f"audit {job.id}")
        self._live[job.id] = _Live(run, task, held)

    async def _drive(
        self,
        run: Run,
        work: Callable[[Run], Awaitable[None]],
        held: list[EventFrame],
    ) -> None:
        try:
            await work(run)
        finally:
            try:
                # An update, not an insert: a job deleted mid-run stays deleted.
                await asyncio.shield(self._repo.update_job(run.job))
            except Exception:
                log.exception("runner.save_failed", job_id=run.job.id)
            finally:
                # A client that has seen these has seen a state the store did
                # not have yet, and every other reader reads the store.
                for frame in held:
                    self._publish(run.job.id, frame)
                self._live.pop(run.job.id, None)

    def _fan_out(self, job_id: str, frame: EventFrame) -> None:
        if frame.event.type in _HELD_UNTIL_STORED:
            live = self._live.get(job_id)
            if live is not None:
                live.held.append(frame)
                return
        self._publish(job_id, frame)

    def _publish(self, job_id: str, frame: EventFrame) -> None:
        subscribers = self._subscribers.get(job_id, set())
        for queue in list(subscribers):
            if queue.qsize() >= _BACKLOG:
                subscribers.discard(queue)
                queue.put_nowait(None)
            else:
                queue.put_nowait(frame)


async def _audit(run: Run) -> None:
    await extract(run)
    if run.job.auto_review and run.job.status == "awaiting_review":
        await verify(run, [c.id for c in run.job.claims])
