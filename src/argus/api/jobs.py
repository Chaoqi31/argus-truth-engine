"""HTTP /jobs endpoints."""
from __future__ import annotations

from pathlib import PurePath
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from argus.api.runner import JobRunner, RunnerCapacityError
from argus.trace_bus.base import TraceEvent


class TextSubmission(BaseModel):
    text: str = Field(..., min_length=50, max_length=200_000)
    auto_review: bool = False
    # general|academic|medical|legal|finance|technology|news|science
    content_domain: str = "general"


class ClaimSelection(BaseModel):
    selected_claim_ids: list[str]

router = APIRouter(prefix="/jobs", tags=["jobs"])

_HTTP_UNSUPPORTED = 415
_HTTP_PAYLOAD_TOO_LARGE = 413
_HTTP_NOT_FOUND = 404
_HTTP_UNAUTHORIZED = 401
_HTTP_BAD_REQUEST = 400
_HTTP_TOO_MANY_REQUESTS = 429


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


async def _progress_from_trace(request: Request, job_id: str) -> dict[str, Any]:
    try:
        async with request.app.state.argus.trace_bus.subscribe(job_id) as sub:
            history = [ev async for ev in sub.iter_history()]
    except Exception:
        return {}
    return _derive_progress(history)


def _derive_progress(history: list[TraceEvent]) -> dict[str, Any]:
    state: dict[str, Any] = {
        "finished_stages": [],
        "current_stage": None,
        "current_claim": None,
        "claims_total": 0,
        "claims_started": set(),
        "claims_finished": set(),
        "last_heartbeat": None,
    }

    for ev in history:
        if ev.kind == "stage":
            _apply_stage_progress(state, ev.payload)
        elif ev.kind == "claim":
            _apply_claim_progress(state, ev.payload)
        elif ev.kind == "heartbeat":
            state["last_heartbeat"] = ev.payload

    return {
        "finished_stages": state["finished_stages"],
        "current_stage": state["current_stage"],
        "claims_started": len(state["claims_started"]),
        "claims_finished": len(state["claims_finished"]),
        "claims_total": state["claims_total"],
        "current_claim": state["current_claim"],
        "last_heartbeat": state["last_heartbeat"],
    }


def _apply_stage_progress(state: dict[str, Any], payload: dict[str, Any]) -> None:
    status = payload.get("status")
    key = payload.get("key")
    if not isinstance(key, str):
        return
    if status == "started":
        state["current_stage"] = {
            "key": key,
            "name": payload.get("name"),
            "engine": payload.get("engine"),
        }
    elif status == "finished":
        if key not in state["finished_stages"]:
            state["finished_stages"].append(key)
        current = state["current_stage"]
        if current and current.get("key") == key:
            state["current_stage"] = None


def _apply_claim_progress(state: dict[str, Any], payload: dict[str, Any]) -> None:
    status = payload.get("status")
    claim_id = payload.get("claim_id")
    total = payload.get("total")
    if isinstance(total, int):
        state["claims_total"] = max(state["claims_total"], total)
    if not isinstance(claim_id, str):
        return
    if status == "started":
        state["claims_started"].add(claim_id)
        state["current_claim"] = {
            "claim_id": claim_id,
            "text": payload.get("text"),
            "index": payload.get("index"),
            "total": total,
        }
    elif status == "finished":
        state["claims_finished"].add(claim_id)
        current = state["current_claim"]
        if current and current.get("claim_id") == claim_id:
            state["current_claim"] = None


@router.post("", status_code=202)
async def submit_job(
    request: Request,
    pdf: UploadFile = File(..., description="PDF to audit"),  # noqa: B008
    content_domain: str = Form("general"),
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
    try:
        job_id = await runner.submit(
            blob,
            _safe_filename(pdf.filename),
            api_key_override=api_key_header or None,
            content_domain=content_domain,
        )
    except RunnerCapacityError as exc:
        raise HTTPException(
            status_code=_HTTP_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    return {"job_id": job_id, "status": "running"}


@router.post("/text", status_code=202)
async def submit_text_job(
    request: Request,
    body: TextSubmission,
) -> dict[str, str]:
    _require_token(request)
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
    try:
        job_id = await runner.submit_text(
            body.text,
            api_key_override=api_key_header or None,
            auto_review=body.auto_review,
            content_domain=body.content_domain,
        )
    except RunnerCapacityError as exc:
        raise HTTPException(
            status_code=_HTTP_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    return {"job_id": job_id, "status": "running"}


@router.post("/{job_id}/claims/select", status_code=200)
async def select_claims(
    request: Request,
    job_id: str,
    body: ClaimSelection,
) -> dict[str, Any]:
    _require_token(request)
    # BYOK: thread the caller's key through so Phase B resume uses their
    # credits, not the operator's. Fall back to a server key for local/CLI.
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
    try:
        resumed = await runner.resume(
            job_id=job_id, selected_claim_ids=body.selected_claim_ids,
            api_key_override=api_key_header or None,
        )
    except RunnerCapacityError as exc:
        raise HTTPException(
            status_code=_HTTP_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    if resumed is None:
        raise HTTPException(
            status_code=_HTTP_NOT_FOUND,
            detail="job not in interrupted state",
        )
    return {"status": "resumed", "n_selected": len(body.selected_claim_ids)}


@router.post("/{job_id}/resume", status_code=202)
async def resume_job(
    request: Request,
    job_id: str,
) -> dict[str, str]:
    """Resume a job previously marked interrupted.

    Used after worker restart (Phase 6.2 marks abandoned jobs), or when
    HITL timeout left the job paused without a claim selection.
    """
    _require_token(request)
    api_key_header = (request.headers.get("x-miromind-key") or "").strip()
    runner = _runner(request)
    try:
        resumed = await runner.resume(
            job_id=job_id, selected_claim_ids=None,
            api_key_override=api_key_header or None,
        )
    except RunnerCapacityError as exc:
        raise HTTPException(
            status_code=_HTTP_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    if resumed is None:
        raise HTTPException(
            status_code=_HTTP_NOT_FOUND,
            detail="job not found or not in interrupted state",
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


@router.get("/{job_id}/report.pdf")
async def get_job_report_pdf(request: Request, job_id: str) -> Response:
    _require_token(request)
    runner = _runner(request)
    record = runner.get(job_id)
    if record is None or record.result is None:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not ready")
    from argus.reporting.pdf import render_job_pdf

    pdf_bytes = render_job_pdf(record.result)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"content-disposition": f'attachment; filename="argus-audit-{job_id}.pdf"'},
    )


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
    return {
        "job_id": record.job_id,
        "status": record.status,
        "error": record.error,
        "progress": await _progress_from_trace(request, job_id),
    }
