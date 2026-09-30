"""HTTP /jobs endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path, PurePath
from secrets import token_urlsafe
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, SecretStr

from argus.api.access import require_job_access
from argus.api.auth import AuthContext, AuthUser, auth_context_from_request, require_user
from argus.api.deps import get_state
from argus.api.runner import CapacityError, JobBusy, JobNotFound, Runner
from argus.config import MIROMIND_ALLOWED_MODELS
from argus.llm.miromind import MiroMindAccess
from argus.models.domain import ContentDomain, new_id
from argus.models.job import Job, NotAwaitingReview, UnknownClaims


class TextSubmission(BaseModel):
    text: str = Field(..., min_length=50, max_length=200_000)
    auto_review: bool = False
    content_domain: ContentDomain = ContentDomain.GENERAL
    miromind_model: str | None = None


class ClaimSelection(BaseModel):
    selected_claim_ids: list[str]
    miromind_model: str | None = None


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
_HTTP_CONFLICT = 409
_HTTP_TOO_MANY_REQUESTS = 429


def _runner(req: Request) -> Runner:
    runner: Runner = req.app.state.argus.runner
    return runner


async def _request_auth(request: Request) -> AuthContext:
    ctx = await auth_context_from_request(request)
    if ctx.user is not None:
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
    if user is not None and cipher is not None:
        found = await repo.get_api_key_ciphertext(user_id=user.id, key_id=key_id)
        if found is not None:
            encrypted_key, _resolved_id = found
            return cipher.decrypt(encrypted_key)
        if key_id is not None:
            raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="saved API key not found")

    server_key = (state.settings.miromind_api_key or "").strip()
    return server_key or None


def _access(request: Request, api_key: str | None, model: str | None) -> MiroMindAccess:
    """Whose key pays, and which model runs. Never stored."""
    if not api_key:
        raise HTTPException(
            status_code=_HTTP_BAD_REQUEST,
            detail=(
                "MiroMind API key required. Paste a key, save one to your account, "
                "or configure ARGUS_MIROMIND_API_KEY on the server."
            ),
        )
    return MiroMindAccess(
        api_key=SecretStr(api_key),
        model=_resolve_miromind_model(model) or get_state(request).settings.miromind_model,
    )


async def _start_audit(
    request: Request, job: Job, access: MiroMindAccess, owner_user_id: str | None
) -> dict[str, str]:
    try:
        await _runner(request).submit(job, access=access, owner_user_id=owner_user_id)
    except CapacityError as exc:
        raise HTTPException(status_code=_HTTP_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    return {"job_id": job.id, "status": job.status}


async def _store_pdf(request: Request, job_id: str, filename: str, blob: bytes) -> str:
    """Store an upload for a new job; returns where the pipeline reads it."""
    # Refuse before writing anything when no run could start anyway.
    try:
        _runner(request).check_capacity()
    except CapacityError as exc:
        raise HTTPException(status_code=_HTTP_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    storage = get_state(request).storage
    key = f"{job_id}/{filename}"
    await storage.put(key, blob, content_type="application/pdf")
    return str(storage.path_for(key))


def _resolve_miromind_model(model: str | None) -> str | None:
    selected = (model or "").strip()
    if not selected:
        return None
    if selected not in MIROMIND_ALLOWED_MODELS:
        raise HTTPException(
            status_code=_HTTP_BAD_REQUEST,
            detail=(
                "Unsupported MiroMind model. Choose one of: "
                + ", ".join(sorted(MIROMIND_ALLOWED_MODELS))
            ),
        )
    return selected


def _safe_filename(filename: str | None) -> str:
    name = PurePath((filename or "upload.pdf").replace("\\", "/")).name
    return name or "upload.pdf"


@router.get("")
async def list_jobs(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
) -> dict[str, list[dict[str, Any]]]:
    ctx = await _request_auth(request)
    settings = request.app.state.argus.settings
    owner_user_id: str | None
    if ctx.user is not None:
        owner_user_id = ctx.user.id
    elif settings.self_hosted and not settings.auth_required:
        owner_user_id = None
    else:
        user = await require_user(request)
        owner_user_id = user.id
    repo = request.app.state.argus.repo
    rows = await repo.list_job_summaries(owner_user_id=owner_user_id, limit=limit)
    return {"jobs": [row.__dict__ for row in rows]}


@router.post("", status_code=202)
async def submit_job(
    request: Request,
    pdf: UploadFile = File(..., description="PDF to audit"),  # noqa: B008
    content_domain: ContentDomain = Form(ContentDomain.GENERAL),  # noqa: B008
    miromind_model: str | None = Form(None),
) -> dict[str, str]:
    ctx = await _request_auth(request)
    if (pdf.content_type or "").lower() != "application/pdf":
        raise HTTPException(status_code=_HTTP_UNSUPPORTED, detail="expected application/pdf")
    max_bytes = get_state(request).settings.max_upload_bytes
    blob = await pdf.read(max_bytes + 1)
    if len(blob) > max_bytes:
        raise HTTPException(status_code=_HTTP_PAYLOAD_TOO_LARGE, detail="pdf too large")
    if not blob.startswith(b"%PDF"):
        raise HTTPException(status_code=_HTTP_UNSUPPORTED, detail="expected PDF file")
    access = _access(request, await _resolve_miromind_key(request, ctx.user), miromind_model)
    job_id = new_id("job")
    job = Job(
        id=job_id,
        pdf_path=await _store_pdf(request, job_id, _safe_filename(pdf.filename), blob),
        input_mode="pdf",
        content_domain=content_domain,
    )
    return await _start_audit(request, job, access, ctx.user.id if ctx.user else None)


@router.post("/text", status_code=202)
async def submit_text_job(
    request: Request,
    body: TextSubmission,
) -> dict[str, str]:
    ctx = await _request_auth(request)
    access = _access(request, await _resolve_miromind_key(request, ctx.user), body.miromind_model)
    job = Job(
        id=new_id("job"),
        input_text=body.text,
        input_mode="text",
        content_domain=body.content_domain,
        auto_review=body.auto_review,
    )
    return await _start_audit(request, job, access, ctx.user.id if ctx.user else None)


@router.post("/{job_id}/claims/select", status_code=200)
async def select_claims(
    request: Request,
    job_id: str,
    body: ClaimSelection,
) -> dict[str, Any]:
    ctx = await _request_auth(request)
    await require_job_access(request, job_id, ctx)
    access = _access(request, await _resolve_miromind_key(request, ctx.user), body.miromind_model)
    try:
        await _runner(request).select(job_id, body.selected_claim_ids, access=access)
    except JobNotFound as exc:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found") from exc
    except (NotAwaitingReview, JobBusy) as exc:
        raise HTTPException(status_code=_HTTP_CONFLICT, detail=str(exc)) from exc
    except UnknownClaims as exc:
        raise HTTPException(status_code=_HTTP_BAD_REQUEST, detail=str(exc)) from exc
    except CapacityError as exc:
        raise HTTPException(status_code=_HTTP_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    return {"status": "resumed", "n_selected": len(body.selected_claim_ids)}


@router.post("/{job_id}/rerun", status_code=202)
async def rerun_job(request: Request, job_id: str) -> dict[str, str]:
    ctx = await _request_auth(request)
    if ctx.user is None:
        raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="login required")
    await require_job_access(request, job_id, ctx)
    job = await get_state(request).repo.get_job_for_user(job_id, ctx.user.id)
    if job is None:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")
    access = _access(request, await _resolve_miromind_key(request, ctx.user), None)
    rerun = Job(
        id=new_id("job"),
        input_mode=job.input_mode,
        input_text=job.input_text,
        content_domain=job.content_domain,
        auto_review=job.auto_review,
    )
    if job.input_mode == "pdf":
        try:
            blob = Path(job.pdf_path).read_bytes()
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=_HTTP_NOT_FOUND, detail="original input not found"
            ) from exc
        rerun.pdf_path = await _store_pdf(
            request, rerun.id, PurePath(job.pdf_path).name or "upload.pdf", blob
        )
    return await _start_audit(request, rerun, access, ctx.user.id)


@router.post("/{job_id}/share", status_code=201)
async def create_share_link(
    request: Request,
    job_id: str,
    body: ShareCreate,
) -> ShareOut:
    user = await require_user(request)
    repo = request.app.state.argus.repo
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
    revoked = await repo.revoke_share_link(job_id=job_id, owner_user_id=user.id, token=token)
    if not revoked:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="share link not found")


@router.delete("/{job_id}", status_code=204)
async def delete_job(request: Request, job_id: str) -> None:
    ctx = await _request_auth(request)
    settings = get_state(request).settings
    if ctx.user is not None:
        owner_user_id = ctx.user.id
    elif settings.self_hosted and not settings.auth_required:
        owner_user_id = None
    else:
        raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="login required")
    deleted = await get_state(request).repo.delete_job_for_user(
        job_id=job_id, owner_user_id=owner_user_id
    )
    if not deleted:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")
    await _runner(request).cancel(job_id)


@router.get("/{job_id}/pdf")
async def get_job_pdf(request: Request, job_id: str) -> FileResponse:
    ctx = await _request_auth(request)
    await require_job_access(request, job_id, ctx)
    job = await _runner(request).get(job_id)
    path = Path(job.pdf_path) if job is not None and job.input_mode == "pdf" else None
    if path is None or not path.is_file():
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="pdf not found")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@router.get("/{job_id}")
async def get_job(request: Request, job_id: str) -> dict[str, Any]:
    ctx = await _request_auth(request)
    await require_job_access(request, job_id, ctx)
    job = await _runner(request).get(job_id)
    if job is None:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")
    if ctx.user is not None:
        await get_state(request).repo.log_job_access(
            job_id=job_id,
            user_id=ctx.user.id,
            actor_type="user",
            metadata={"source": "job_get"},
        )
    dumped: dict[str, Any] = job.model_dump(mode="json")
    return dumped