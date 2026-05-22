"""HTTP /jobs endpoints."""
from __future__ import annotations

from pathlib import PurePath
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from argus.api.runner import JobRunner

router = APIRouter(prefix="/jobs", tags=["jobs"])

_HTTP_UNSUPPORTED = 415
_HTTP_PAYLOAD_TOO_LARGE = 413
_HTTP_NOT_FOUND = 404
_HTTP_UNAUTHORIZED = 401
_HTTP_BAD_REQUEST = 400


def _runner(req: Request) -> JobRunner:
    runner: JobRunner | None = getattr(req.app.state, "runner", None)
    if runner is None:
        runner = JobRunner(state=req.app.state.argus)
        req.app.state.runner = runner
    return runner


def _require_token(request: Request) -> None:
    token = request.app.state.argus.settings.api_token
    if not token:
        return
    expected = f"Bearer {token}"
    if request.headers.get("authorization") != expected:
        raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="unauthorized")


def _safe_filename(filename: str | None) -> str:
    name = PurePath((filename or "upload.pdf").replace("\\", "/")).name
    return name or "upload.pdf"


@router.post("", status_code=202)
async def submit_job(
    request: Request,
    pdf: UploadFile = File(..., description="PDF to audit"),  # noqa: B008
) -> dict[str, str]:
    _require_token(request)
    if (pdf.content_type or "").lower() != "application/pdf":
        raise HTTPException(status_code=_HTTP_UNSUPPORTED, detail="expected application/pdf")
    max_bytes = request.app.state.argus.settings.max_upload_bytes
    blob = await pdf.read(max_bytes + 1)
    if len(blob) > max_bytes:
        raise HTTPException(status_code=_HTTP_PAYLOAD_TOO_LARGE, detail="pdf too large")
    if not blob.startswith(b"%PDF"):
        raise HTTPException(status_code=_HTTP_UNSUPPORTED, detail="expected PDF file")
    # BYOK: per-request MiroMind key takes precedence over server config so the
    # public demo never burns the operator's credits. Strip whitespace because
    # browsers + clipboard managers love to add it.
    api_key_header = (request.headers.get("x-miromind-key") or "").strip()
    server_key = (request.app.state.argus.settings.miromind_api_key or "").strip()
    if not api_key_header and not server_key:
        raise HTTPException(
            status_code=_HTTP_BAD_REQUEST,
            detail=(
                "MiroMind API key required. Pass it via the X-Miromind-Key "
                "request header, or configure ARGUS_MIROMIND_API_KEY on the server."
            ),
        )
    runner = _runner(request)
    job_id = await runner.submit(
        blob,
        _safe_filename(pdf.filename),
        api_key_override=api_key_header or None,
    )
    return {"job_id": job_id, "status": "running"}


@router.get("/{job_id}/pdf")
async def get_job_pdf(request: Request, job_id: str) -> FileResponse:
    _require_token(request)
    runner = _runner(request)
    record = runner.get(job_id)
    if record is None or not record.pdf_key:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="pdf not found")
    path = runner.state.storage.path_for(record.pdf_key)
    if not path.exists():
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="pdf not found")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@router.get("/{job_id}")
async def get_job(request: Request, job_id: str) -> dict[str, Any]:
    _require_token(request)
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
