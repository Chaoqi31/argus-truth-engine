"""Shared job access control for HTTP and WebSocket handlers."""
from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, Request, WebSocket

from argus.api.auth import AuthContext

if TYPE_CHECKING:
    from argus.api.runner import JobRunner

_HTTP_NOT_FOUND = 404
_HTTP_UNAUTHORIZED = 401


async def require_job_access(
    target: Request | WebSocket,
    job_id: str,
    ctx: AuthContext,
    *,
    runner: JobRunner | None = None,
) -> None:
    if ctx.service:
        return
    settings = target.app.state.argus.settings
    if ctx.user is None:
        if settings.auth_required:
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="login required")
        return

    active_runner = runner or getattr(target.app.state, "runner", None)
    if active_runner is not None:
        record = active_runner.get(job_id)
        if record is not None:
            if record.owner_user_id == ctx.user.id:
                return
            if record.owner_user_id is not None:
                raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")

    repo = target.app.state.argus.repo
    if repo is not None:
        owner = await repo.get_job_owner(job_id)
        if owner == ctx.user.id:
            return
        if owner is not None or settings.auth_required:
            raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="job not found")
