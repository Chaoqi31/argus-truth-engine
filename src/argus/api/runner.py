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

from pydantic import SecretStr

from argus.api.deps import AppState
from argus.llm import Llm
from argus.llm.miromind import MiroMindAccess
from argus.log import log
from argus.models.domain import Job
from argus.orchestrator import audit_pdf, audit_text
from argus.orchestrator.entry import audit_resume


class RunnerCapacityError(RuntimeError):
    """Raised when the process already has too many active audits."""


@dataclass
class JobRecord:
    job_id: str
    status: str = "running"
    result: Job | None = None
    error: str | None = None
    pdf_key: str = ""
    owner_user_id: str | None = None


@dataclass
class JobRunner:
    state: AppState
    records: dict[str, JobRecord] = field(default_factory=dict)
    tasks: dict[str, asyncio.Task[None]] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def _llm(self, api_key_override: str | None, miromind_model: str | None) -> Llm:
        # BYOK: the caller's key (X-Miromind-Key header or a saved key) pays for
        # the job, so a public deploy never spends the operator's credits. The
        # server key covers local and CLI use.
        settings = self.state.settings
        return self.state.transports.for_job(
            MiroMindAccess(
                api_key=SecretStr(api_key_override or settings.miromind_api_key),
                model=miromind_model or settings.miromind_model,
            )
        )

    async def _reserve(self, record: JobRecord) -> None:
        async with self.lock:
            active = sum(1 for r in self.records.values() if r.status == "running")
            if active >= self.state.settings.max_active_jobs:
                raise RunnerCapacityError("Too many active audits; try again later.")
            self.records[record.job_id] = record

    async def _reserve_resume(self, job_id: str) -> JobRecord:
        async with self.lock:
            existing = self.records.get(job_id)
            if existing is not None and existing.status == "running":
                raise RunnerCapacityError("This audit is already running.")
            active = sum(1 for r in self.records.values() if r.status == "running")
            if active >= self.state.settings.max_active_jobs:
                raise RunnerCapacityError("Too many active audits; try again later.")
            record = existing or JobRecord(job_id=job_id)
            record.status = "running"
            record.error = None
            self.records[job_id] = record
            return record

    async def submit(
        self,
        pdf_bytes: bytes,
        filename: str,
        api_key_override: str | None = None,
        miromind_model: str | None = None,
        content_domain: str = "general",
        owner_user_id: str | None = None,
    ) -> str:
        job_id = f"job_{uuid4().hex[:12]}"
        key = f"{job_id}/{filename}"
        record = JobRecord(
            job_id=job_id,
            status="running",
            pdf_key=key,
            owner_user_id=owner_user_id,
        )
        await self._reserve(record)
        await self.state.storage.put(key, pdf_bytes, content_type="application/pdf")
        await self.state.repo.save_job(
            Job(
                id=job_id,
                pdf_path=str(self.state.storage.path_for(key)),
                input_mode="pdf",
                content_domain=content_domain,
            ),
            owner_user_id=owner_user_id,
        )

        llm = self._llm(api_key_override, miromind_model)

        async def _run() -> None:
            try:
                pdf_path = self.state.storage.path_for(key)
                output_path = Path(str(pdf_path)).with_suffix(".findings.json")
                job = await audit_pdf(
                    pdf_path=pdf_path,
                    output_path=output_path,
                    settings=self.state.settings,
                    llm=llm,
                    budget_usd=self.state.settings.job_budget_usd,
                    repo=self.state.repo,
                    trace_bus=self.state.trace_bus,
                    job_id=job_id,
                    content_domain=content_domain,
                )
                self.records[job_id].result = job
                self.records[job_id].status = job.status
            except Exception as exc:
                self.records[job_id].status = "failed"
                self.records[job_id].error = str(exc)[:300]
                log.error("api.runner.failed", job_id=job_id, error=str(exc)[:300])

        self.tasks[job_id] = asyncio.create_task(_run())
        return job_id

    async def submit_text(
        self,
        text: str,
        api_key_override: str | None = None,
        miromind_model: str | None = None,
        auto_review: bool = False,
        content_domain: str = "general",
        owner_user_id: str | None = None,
    ) -> str:
        job_id = f"job_{uuid4().hex[:12]}"
        key = f"{job_id}/input.txt"
        record = JobRecord(job_id=job_id, status="running", owner_user_id=owner_user_id)
        await self._reserve(record)
        await self.state.storage.put(key, text.encode(), content_type="text/plain")
        await self.state.repo.save_job(
            Job(
                id=job_id,
                input_text=text,
                input_mode="text",
                content_domain=content_domain,
                auto_review=auto_review,
            ),
            owner_user_id=owner_user_id,
        )

        llm = self._llm(api_key_override, miromind_model)

        async def _run() -> None:
            try:
                txt_path = self.state.storage.path_for(key)
                output_path = Path(str(txt_path)).with_suffix(".findings.json")
                job = await audit_text(
                    text=text,
                    output_path=output_path,
                    settings=self.state.settings,
                    llm=llm,
                    budget_usd=self.state.settings.job_budget_usd,
                    repo=self.state.repo,
                    trace_bus=self.state.trace_bus,
                    job_id=job_id,
                    auto_review=auto_review,
                    content_domain=content_domain,
                )
                self.records[job_id].result = job
                self.records[job_id].status = job.status
            except Exception as exc:
                self.records[job_id].status = "failed"
                self.records[job_id].error = str(exc)[:300]
                log.error("api.runner.text_failed", job_id=job_id, error=str(exc)[:300])

        self.tasks[job_id] = asyncio.create_task(_run())
        return job_id

    async def resume(
        self,
        *,
        job_id: str,
        selected_claim_ids: list[str],
        api_key_override: str | None = None,
        miromind_model: str | None = None,
    ) -> str | None:
        """Verify the claims a reviewer kept on a job awaiting review. Returns
        the job id, or None when no such job is awaiting review."""
        repo = self.state.repo
        record = self.records.get(job_id)
        if record is None:
            job = await repo.get_job(job_id)
            if job is None or job.status != "awaiting_review":
                return None
        record = await self._reserve_resume(job_id)

        output_path = Path(
            self.state.storage.path_for(record.pdf_key or f"{job_id}/input.txt")
        ).with_suffix(".findings.json")

        llm = self._llm(api_key_override, miromind_model)

        async def _run() -> None:
            try:
                job = await audit_resume(
                    job_id=job_id,
                    selected_claim_ids=selected_claim_ids,
                    settings=self.state.settings,
                    llm=llm,
                    budget_usd=self.state.settings.job_budget_usd,
                    repo=repo,
                    trace_bus=self.state.trace_bus,
                    output_path=output_path,
                )
                self.records[job_id].result = job
                self.records[job_id].status = job.status
            except Exception as exc:
                self.records[job_id].status = "failed"
                self.records[job_id].error = str(exc)[:300]
                log.error("api.runner.resume_failed", job_id=job_id, error=str(exc)[:300])

        self.tasks[job_id] = asyncio.create_task(_run())
        return job_id

    def get(self, job_id: str) -> JobRecord | None:
        return self.records.get(job_id)
