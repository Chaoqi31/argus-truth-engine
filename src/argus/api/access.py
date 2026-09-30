"""Shared job access control for HTTP and WebSocket handlers."""
from __future__ import annotations

from fastapi import HTTPException, Request, WebSocket

from argus.api.auth import AuthContext

_HTTP_NOT_FOUND = 404
_HTTP_UNAUTHORIZED = 401


async def require_job_access(
    target: Request | WebSocket,
    job_id: str,
    ctx: AuthContext,
) -> None:
    if ctx.service:
        return
    settings = target.app.state.argus.settings
    if ctx.user is None:
        if settings.auth_required:
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="login required")
        return

    owner = await target.app.state.argus.repo.get_job_owner(job_id)
    if owner == ctx.user.id:
        return
    if owner is not None or settings.auth_required:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")
