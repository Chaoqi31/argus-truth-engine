"""Public read-only audit share endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/share", tags=["share"])


@router.get("/{token}")
async def get_shared_audit(request: Request, token: str) -> dict[str, Any]:
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=500, detail="database is not configured")
    job = await repo.get_job_by_share_token(token)
    if job is None:
        raise HTTPException(status_code=404, detail="share link not found")
    dumped: dict[str, Any] = job.model_dump(mode="json")
    return dumped
