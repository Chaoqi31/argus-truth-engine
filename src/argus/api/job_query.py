"""Unified job read path for HTTP APIs — runner memory first, then DB."""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from argus.api.job_progress import progress_from_trace
from argus.models.domain import Job

if TYPE_CHECKING:
    from argus.api.runner import JobRunner
    from argus.db.repository import JobRepository
    from argus.trace_bus.base import TraceBus


@dataclass(frozen=True)
class RunningJobSnapshot:
    job_id: str
    status: str
    error: str | None
    progress: dict[str, Any]


async def get_job_for_api(
    job_id: str,
    *,
    runner: JobRunner,
    repo: JobRepository | None,
    trace_bus: TraceBus | None = None,
) -> Job | RunningJobSnapshot | None:
    """Resolve a job for GET /jobs/{id}.

  Active in-memory runs are served from the runner; completed jobs fall back
  to the DB when persistence is configured. JSON files on disk are for
  CLI/debug only — not the HTTP primary path.
    """
    record = runner.get(job_id)
    if record is not None:
        if record.result is not None:
            return record.result
        progress: dict[str, Any] = {}
        if trace_bus is not None:
            progress = await progress_from_trace(trace_bus, job_id)
        return RunningJobSnapshot(
            job_id=record.job_id,
            status=record.status,
            error=record.error,
            progress=progress,
        )

    if repo is not None:
        return await repo.get_job(job_id)
    return None
