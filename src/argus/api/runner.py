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
from argus.miromind.client import MiromindClient
from argus.models.domain import Job
from argus.orchestrator import audit_pdf, audit_text
from argus.orchestrator.entry import audit_resume


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

    async def submit(
        self,
        pdf_bytes: bytes,
        filename: str,
        api_key_override: str | None = None,
        content_domain: str = "general",
    ) -> str:
        job_id = f"job_{uuid4().hex[:12]}"
        key = f"{job_id}/{filename}"
        await self.state.storage.put(key, pdf_bytes, content_type="application/pdf")
        record = JobRecord(job_id=job_id, status="running", pdf_key=key)
        self.records[job_id] = record

        # BYOK: when the caller supplies their own MiroMind key (via the
        # X-Miromind-Key header), bake it into a per-job Settings + Client so
        # the public demo never burns the operator's own credits. When absent
        # we fall back to the server's configured key (used for local/CLI).
        per_job_settings = self.state.settings
        per_job_client: MiromindClient | None = None
        if api_key_override:
            per_job_settings = self.state.settings.model_copy(
                update={"miromind_api_key": api_key_override}
            )
            per_job_client = MiromindClient(per_job_settings)

        async def _run() -> None:
            try:
                pdf_path = self.state.storage.path_for(key)
                output_path = Path(str(pdf_path)).with_suffix(".findings.json")
                job = await audit_pdf(
                    pdf_path=pdf_path,
                    output_path=output_path,
                    settings=per_job_settings,
                    client=per_job_client,
                    budget_usd=per_job_settings.job_budget_usd,
                    repo=self.state.repo,
                    trace_bus=self.state.trace_bus,
                    job_id=job_id,
                    content_domain=content_domain,
                    checkpointer=self.state.checkpointer,
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
        auto_review: bool = False,
        content_domain: str = "general",
    ) -> str:
        job_id = f"job_{uuid4().hex[:12]}"
        key = f"{job_id}/input.txt"
        await self.state.storage.put(key, text.encode(), content_type="text/plain")
        record = JobRecord(job_id=job_id, status="running")
        self.records[job_id] = record

        per_job_settings = self.state.settings
        per_job_client: MiromindClient | None = None
        if api_key_override:
            per_job_settings = self.state.settings.model_copy(
                update={"miromind_api_key": api_key_override}
            )
            per_job_client = MiromindClient(per_job_settings)

        async def _run() -> None:
            try:
                txt_path = self.state.storage.path_for(key)
                output_path = Path(str(txt_path)).with_suffix(".findings.json")
                job = await audit_text(
                    text=text,
                    output_path=output_path,
                    settings=per_job_settings,
                    client=per_job_client,
                    budget_usd=per_job_settings.job_budget_usd,
                    repo=self.state.repo,
                    trace_bus=self.state.trace_bus,
                    job_id=job_id,
                    auto_review=auto_review,
                    content_domain=content_domain,
                    checkpointer=self.state.checkpointer,
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
        selected_claim_ids: list[str] | None,
        api_key_override: str | None = None,
    ) -> str | None:
        """Resume an interrupted job. Returns job_id on success, None if not found."""
        repo = self.state.repo
        if repo is None:
            return None

        record = self.records.get(job_id)
        if record is None:
            job = await repo.get_job(job_id)
            if job is None or job.status != "interrupted":
                return None
            record = JobRecord(job_id=job_id, status="running")
            self.records[job_id] = record
        else:
            record.status = "running"

        output_path = Path(
            self.state.storage.path_for(record.pdf_key or f"{job_id}/input.txt")
        ).with_suffix(".findings.json")

        # BYOK: prefer the caller's key (Phase B verification burns the most
        # credits) so prod — which has no server MiroMind key — can resume.
        # Falls back to the server key for local/CLI resume.
        per_job_settings = self.state.settings
        if api_key_override:
            per_job_settings = self.state.settings.model_copy(
                update={"miromind_api_key": api_key_override}
            )
        per_job_client = MiromindClient(per_job_settings)

        async def _run() -> None:
            try:
                job = await audit_resume(
                    job_id=job_id,
                    selected_claim_ids=selected_claim_ids,
                    settings=per_job_settings,
                    client=per_job_client,
                    budget_usd=per_job_settings.job_budget_usd,
                    repo=repo,
                    trace_bus=self.state.trace_bus,
                    output_path=output_path,
                    checkpointer=self.state.checkpointer,
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
