"""WebSocket /ws/jobs/{id}/trace — replay history then stream live events."""
from __future__ import annotations

import contextlib
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from argus.api.access import require_job_access
from argus.api.auth import auth_context_from_websocket
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
        await require_job_access(websocket, job_id, ctx)
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

