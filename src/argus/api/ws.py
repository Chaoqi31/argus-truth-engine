"""WebSocket /ws/jobs/{id}: the job, then every change to it.

Every connection starts with a snapshot of the job and then streams the
events applied to it, so reconnecting, reloading, and opening a second tab
are the same case. The socket closes after the event that finishes a run; a
job paused for review keeps it open for the run that resumes it.
"""
from __future__ import annotations

import contextlib

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from argus.api.access import require_job_access
from argus.api.auth import auth_context_from_websocket
from argus.api.runner import JobNotFound, Runner

router = APIRouter(prefix="/ws", tags=["ws"])

_FELL_BEHIND = 1013  # "try again later": the client reconnects from a snapshot


@router.websocket("/jobs/{job_id}")
async def job_live(websocket: WebSocket, job_id: str, token: str | None = None) -> None:
    runner: Runner = websocket.app.state.argus.runner
    try:
        ctx = await auth_context_from_websocket(websocket, token)
        await require_job_access(websocket, job_id, ctx)
    except HTTPException:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        async with runner.subscribe(job_id) as feed:
            await websocket.send_text(feed.snapshot_json)
            if feed.terminal:
                await websocket.close()
                return
            async for frame in feed.frames():
                await websocket.send_text(frame.model_dump_json())
                if frame.event.type == "finished":
                    await websocket.close()
                    return
            await websocket.close(code=_FELL_BEHIND)
    except JobNotFound:
        await websocket.close(code=1008)
    except WebSocketDisconnect:
        return
    finally:
        # The socket may already be closed by either side.
        with contextlib.suppress(RuntimeError):
            await websocket.close()
