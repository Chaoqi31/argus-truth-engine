"""Lightweight product event ingestion."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from argus.api.auth import auth_context_from_request

router = APIRouter(prefix="/events", tags=["events"])


class ProductEvent(BaseModel):
    event_name: str = Field(..., min_length=2, max_length=80)
    path: str | None = Field(default=None, max_length=240)
    properties: dict[str, Any] = Field(default_factory=dict)


@router.post("", status_code=202)
async def record_event(request: Request, body: ProductEvent) -> dict[str, str]:
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=500, detail="database is not configured")
    try:
        ctx = await auth_context_from_request(request)
    except HTTPException:
        ctx = None
    await repo.record_event(
        event_name=body.event_name,
        user_id=ctx.user.id if ctx is not None and ctx.user is not None else None,
        path=body.path,
        properties=body.properties,
    )
    return {"status": "accepted"}
