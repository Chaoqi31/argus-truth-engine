"""In-process background job runner.

Tracks ``job_id -> JobRecord`` and ``job_id -> asyncio.Task`` so:

* ``POST /jobs`` returns immediately after scheduling the audit task
* ``GET  /jobs/{id}`` can answer with ``running``/``failed``/the final Job
  even when DB persistence isn't configured.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from argus.api.deps import AppState
from argus.log import log
from argus.models.domain import Job
from argus.orchestrator import audit_pdf


@dataclass
class JobRecord:
    job_id: str
    status: str = "queued"
    result: Job | None = None
    error: str | None = None
    pdf_key: str = ""


@dataclass
class JobRunner:
    state: AppState
    records: dict[str, JobRecord] = field(default_factory=dict)
    tasks: dict[str, asyncio.Task[None]] = field(default_factory=dict)

    async def submit(self, pdf_bytes: bytes, filename: str) -> str:
        job_id = f"job_{uuid4().hex[:12]}"
        key = f"{job_id}/{filename}"
        await self.state.storage.put(key, pdf_bytes, content_type="application/pdf")
        record = JobRecord(job_id=job_id, status="running", pdf_key=key)
        self.records[job_id] = record

        async def _run() -> None:
            try:
                pdf_path = self.state.storage.path_for(key)
                output_path = Path(str(pdf_path)).with_suffix(".findings.json")
                job = await audit_pdf(
                    pdf_path=pdf_path,
                    output_path=output_path,
                    settings=self.state.settings,
                    budget_usd=self.state.settings.job_budget_usd,
                    repo=self.state.repo,
                    trace_bus=self.state.trace_bus,
                    job_id=job_id,
                )
                self.records[job_id].result = job
                self.records[job_id].status = job.status
            except Exception as exc:
                self.records[job_id].status = "failed"
                self.records[job_id].error = str(exc)[:300]
                log.error("api.runner.failed", job_id=job_id, error=str(exc)[:300])

        self.tasks[job_id] = asyncio.create_task(_run())
        return job_id

    def get(self, job_id: str) -> JobRecord | None:
        return self.records.get(job_id)
