"""HTTP /jobs endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import PurePath
from secrets import token_urlsafe
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from argus.api.access import require_job_access
from argus.api.auth import AuthContext, AuthUser, auth_context_from_request, require_user
from argus.api.deps import get_state
from argus.api.job_query import RunningJobSnapshot, get_job_for_api
from argus.api.runner import JobRunner, RunnerCapacityError
from argus.models.domain import Job


class TextSubmission(BaseModel):
    text: str = Field(..., min_length=50, max_length=200_000)
    auto_review: bool = False
    # general|academic|medical|legal|finance|technology|news|science
    content_domain: str = "general"


class ClaimSelection(BaseModel):
    selected_claim_ids: list[str]


class ShareCreate(BaseModel):
    expires_in_days: int | None = Field(default=30, ge=1, le=365)


class ShareOut(BaseModel):
    token: str
    job_id: str
    created_at: datetime
    expires_at: datetime | None


router = APIRouter(prefix="/jobs", tags=["jobs"])

_HTTP_UNSUPPORTED = 415
_HTTP_PAYLOAD_TOO_LARGE = 413
_HTTP_NOT_FOUND = 404
_HTTP_UNAUTHORIZED = 401
_HTTP_BAD_REQUEST = 400
_HTTP_TOO_MANY_REQUESTS = 429
_HTTP_SERVER_ERROR = 500


def _runner(req: Request) -> JobRunner:
    runner: JobRunner | None = getattr(req.app.state, "runner", None)
    if runner is None:
        runner = JobRunner(state=req.app.state.argus)
        req.app.state.runner = runner
    return runner


async def _request_auth(request: Request) -> AuthContext:
    ctx = await auth_context_from_request(request)
    if ctx.user is not None and request.app.state.argus.repo is not None:
        await request.app.state.argus.repo.upsert_user(ctx.user)
    return ctx


async def _resolve_miromind_key(request: Request, user: AuthUser | None) -> str | None:
    raw_key = (request.headers.get("x-miromind-key") or "").strip()
    if raw_key:
        return raw_key

    key_id = (request.headers.get("x-miromind-key-id") or "").strip() or None
    state = get_state(request)
    repo = state.repo
    cipher = state.key_cipher
    if user is not None and repo is not None and cipher is not None:
        found = await repo.get_api_key_ciphertext(user_id=user.id, key_id=key_id)
        if found is not None:
            encrypted_key, _resolved_id = found
            return cipher.decrypt(encrypted_key)
        if key_id is not None:
            raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="saved API key not found")

    server_key = (state.settings.miromind_api_key or "").strip()
    return server_key or None


def _require_miromind_key(api_key: str | None) -> str:
    if api_key:
        return api_key
    raise HTTPException(
        status_code=_HTTP_BAD_REQUEST,
        detail=(
            "MiroMind API key required. Paste a key, save one to your account, "
            "or configure ARGUS_MIROMIND_API_KEY on the server."
        ),
    )


def _safe_filename(filename: str | None) -> str:
    name = PurePath((filename or "upload.pdf").replace("\\", "/")).name
    return name or "upload.pdf"


@router.get("")
async def list_jobs(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
) -> dict[str, list[dict[str, Any]]]:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    rows = await repo.list_job_summaries(owner_user_id=user.id, limit=limit)
    return {"jobs": [row.__dict__ for row in rows]}


@router.post("", status_code=202)
async def submit_job(
    request: Request,
    pdf: UploadFile = File(..., description="PDF to audit"),  # noqa: B008
    content_domain: str = Form("general"),
) -> dict[str, str]:
    ctx = await _request_auth(request)
    if (pdf.content_type or "").lower() != "application/pdf":
        raise HTTPException(status_code=_HTTP_UNSUPPORTED, detail="expected application/pdf")
    max_bytes = request.app.state.argus.settings.max_upload_bytes
    blob = await pdf.read(max_bytes + 1)
    if len(blob) > max_bytes:
        raise HTTPException(status_code=_HTTP_PAYLOAD_TOO_LARGE, detail="pdf too large")
    if not blob.startswith(b"%PDF"):
        raise HTTPException(status_code=_HTTP_UNSUPPORTED, detail="expected PDF file")
    api_key = _require_miromind_key(await _resolve_miromind_key(request, ctx.user))
    runner = _runner(request)
    try:
        job_id = await runner.submit(
            blob,
            _safe_filename(pdf.filename),
            api_key_override=api_key,
            content_domain=content_domain,
            owner_user_id=ctx.user.id if ctx.user else None,
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
    ctx = await _request_auth(request)
    api_key = _require_miromind_key(await _resolve_miromind_key(request, ctx.user))
    runner = _runner(request)
    try:
        job_id = await runner.submit_text(
            body.text,
            api_key_override=api_key,
            auto_review=body.auto_review,
            content_domain=body.content_domain,
            owner_user_id=ctx.user.id if ctx.user else None,
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
    ctx = await _request_auth(request)
    runner = _runner(request)
    await require_job_access(request, job_id, ctx, runner=runner)
    api_key = _require_miromind_key(await _resolve_miromind_key(request, ctx.user))
    try:
        resumed = await runner.resume(
            job_id=job_id, selected_claim_ids=body.selected_claim_ids,
            api_key_override=api_key,
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
    ctx = await _request_auth(request)
    runner = _runner(request)
    await require_job_access(request, job_id, ctx, runner=runner)
    api_key = _require_miromind_key(await _resolve_miromind_key(request, ctx.user))
    try:
        resumed = await runner.resume(
            job_id=job_id, selected_claim_ids=None,
            api_key_override=api_key,
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


@router.post("/{job_id}/rerun", status_code=202)
async def rerun_job(request: Request, job_id: str) -> dict[str, str]:
    ctx = await _request_auth(request)
    if ctx.user is None:
        raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="login required")
    runner = _runner(request)
    await require_job_access(request, job_id, ctx, runner=runner)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    job = await repo.get_job_for_user(job_id, ctx.user.id)
    if job is None:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")
    api_key = _require_miromind_key(await _resolve_miromind_key(request, ctx.user))
    content_domain = str(getattr(job.content_domain, "value", job.content_domain))
    try:
        if job.input_mode == "text" and job.input_text:
            new_job_id = await runner.submit_text(
                text=job.input_text,
                api_key_override=api_key,
                auto_review=job.auto_review,
                content_domain=content_domain,
                owner_user_id=ctx.user.id,
            )
        else:
            path = PurePath(job.pdf_path)
            try:
                blob = request.app.state.argus.storage.path_for(str(path)).read_bytes()
            except Exception:
                from pathlib import Path

                blob = Path(job.pdf_path).read_bytes()
            new_job_id = await runner.submit(
                blob,
                path.name or "upload.pdf",
                api_key_override=api_key,
                content_domain=content_domain,
                owner_user_id=ctx.user.id,
            )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="original input not found") from exc
    except RunnerCapacityError as exc:
        raise HTTPException(status_code=_HTTP_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    return {"job_id": new_job_id, "status": "running"}


@router.post("/{job_id}/share", status_code=201)
async def create_share_link(
    request: Request,
    job_id: str,
    body: ShareCreate,
) -> ShareOut:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    expires_at = (
        datetime.utcnow() + timedelta(days=body.expires_in_days)
        if body.expires_in_days is not None
        else None
    )
    created = await repo.create_share_link(
        job_id=job_id,
        owner_user_id=user.id,
        token=token_urlsafe(24),
        expires_at=expires_at,
    )
    if created is None:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")
    return ShareOut(
        token=created.token,
        job_id=created.job_id,
        created_at=created.created_at,
        expires_at=created.expires_at,
    )


@router.delete("/{job_id}/share/{token}", status_code=204)
async def revoke_share_link(request: Request, job_id: str, token: str) -> None:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    revoked = await repo.revoke_share_link(job_id=job_id, owner_user_id=user.id, token=token)
    if not revoked:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="share link not found")


@router.delete("/{job_id}", status_code=204)
async def delete_job(request: Request, job_id: str) -> None:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    deleted = await repo.delete_job_for_user(job_id=job_id, owner_user_id=user.id)
    if not deleted:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")


@router.get("/{job_id}/pdf")
async def get_job_pdf(request: Request, job_id: str) -> FileResponse:
    ctx = await _request_auth(request)
    runner = _runner(request)
    await require_job_access(request, job_id, ctx, runner=runner)
    record = runner.get(job_id)
    if record is None or not record.pdf_key:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="pdf not found")
    path = runner.state.storage.path_for(record.pdf_key)
    if not path.exists():
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="pdf not found")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@router.get("/{job_id}/report.pdf")
async def get_job_report_pdf(request: Request, job_id: str) -> Response:
    ctx = await _request_auth(request)
    runner = _runner(request)
    await require_job_access(request, job_id, ctx, runner=runner)
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
    ctx = await _request_auth(request)
    runner = _runner(request)
    await require_job_access(request, job_id, ctx, runner=runner)
    resolved = await get_job_for_api(
        job_id,
        runner=runner,
        repo=request.app.state.argus.repo,
        trace_bus=request.app.state.argus.trace_bus,
    )
    if resolved is None:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")

    repo = request.app.state.argus.repo
    if isinstance(resolved, Job) and repo is not None and ctx.user is not None:
        await repo.log_job_access(
            job_id=job_id,
            user_id=ctx.user.id,
            actor_type="user",
            metadata={"source": "job_get"},
        )
        return resolved.model_dump(mode="json")

    if isinstance(resolved, RunningJobSnapshot):
        return {
            "job_id": resolved.job_id,
            "status": resolved.status,
            "error": resolved.error,
            "progress": resolved.progress,
        }

    dumped: dict[str, Any] = resolved.model_dump(mode="json")
    return dumped
