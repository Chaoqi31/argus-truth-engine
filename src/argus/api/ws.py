"""WebSocket /ws/jobs/{id}/trace — replay history then stream live events."""
from __future__ import annotations

import contextlib
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from argus.api.auth import AuthContext, auth_context_from_websocket
from argus.trace_bus.base import TraceEvent

router = APIRouter(prefix="/ws", tags=["ws"])


@router.websocket("/jobs/{job_id}/trace")
async def trace_ws(
    websocket: WebSocket,
    job_id: str,
    after: int = 0,
    token: str | None = None,
) -> None:
    state = websocket.app.state.argus
    bus = state.trace_bus
    try:
        ctx = await auth_context_from_websocket(websocket, token)
        await _require_job_access(websocket, job_id, ctx)
    except HTTPException:
        await websocket.close(code=1008)
        return
    await websocket.accept()

    try:
        async with bus.subscribe(job_id, after=after) as sub:
            # Replay history first.
            async for ev in sub.iter_history():
                await websocket.send_text(_encode(ev))
                if ev.kind in ("finished", "failed"):
                    return
            # Then stream live events until terminal or disconnect.
            async for ev in sub.iter_live():
                await websocket.send_text(_encode(ev))
                if ev.kind in ("finished", "failed"):
                    return
    except WebSocketDisconnect:
        return
    finally:
        # Already closed on terminal event or disconnect race — suppress.
        with contextlib.suppress(RuntimeError):
            await websocket.close()


def _encode(ev: TraceEvent) -> str:
    return json.dumps(
        {
            "job_id": ev.job_id,
            "sequence": ev.sequence,
            "kind": ev.kind,
            "payload": ev.payload,
        }
    )


async def _require_job_access(
    websocket: WebSocket,
    job_id: str,
    ctx: AuthContext,
) -> None:
    if ctx.service:
        return
    settings = websocket.app.state.argus.settings
    if ctx.user is None:
        if settings.auth_required:
            raise HTTPException(status_code=401, detail="login required")
        return

    runner = getattr(websocket.app.state, "runner", None)
    if runner is not None:
        record = runner.get(job_id)
        if record is not None:
            if record.owner_user_id == ctx.user.id:
                return
            if record.owner_user_id is not None:
                raise HTTPException(status_code=404, detail="job not found")

    repo = websocket.app.state.argus.repo
    if repo is not None:
        owner = await repo.get_job_owner(job_id)
        if owner == ctx.user.id:
            return
        if owner is not None or settings.auth_required:
            raise HTTPException(status_code=404, detail="job not found")
