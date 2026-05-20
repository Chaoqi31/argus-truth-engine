"""HTTP /jobs endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from argus.api.runner import JobRunner

router = APIRouter(prefix="/jobs", tags=["jobs"])

_HTTP_UNSUPPORTED = 415
_HTTP_NOT_FOUND = 404


def _runner(req: Request) -> JobRunner:
    runner: JobRunner | None = getattr(req.app.state, "runner", None)
    if runner is None:
        runner = JobRunner(state=req.app.state.argus)
        req.app.state.runner = runner
    return runner


@router.post("", status_code=202)
async def submit_job(
    request: Request,
    pdf: UploadFile = File(..., description="PDF to audit"),  # noqa: B008
) -> dict[str, str]:
    if (pdf.content_type or "").lower() != "application/pdf":
        raise HTTPException(status_code=_HTTP_UNSUPPORTED, detail="expected application/pdf")
    blob = await pdf.read()
    runner = _runner(request)
    job_id = await runner.submit(blob, pdf.filename or "upload.pdf")
    return {"job_id": job_id, "status": "running"}


@router.get("/{job_id}")
async def get_job(request: Request, job_id: str) -> dict[str, Any]:
    runner = _runner(request)
    record = runner.get(job_id)
    if record is None:
        repo = request.app.state.argus.repo
        if repo is not None:
            job = await repo.get_job(job_id)
            if job is not None:
                dumped: dict[str, Any] = job.model_dump(mode="json")
                return dumped
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")

    if record.result is not None:
        result_dump: dict[str, Any] = record.result.model_dump(mode="json")
        return result_dump
    return {"job_id": record.job_id, "status": record.status, "error": record.error}
