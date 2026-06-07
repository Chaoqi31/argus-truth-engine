"""User account endpoints."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from argus.api.auth import require_user

router = APIRouter(prefix="/me", tags=["account"])

_HTTP_SERVER_ERROR = 500
_HTTP_NOT_FOUND = 404


class ApiKeyCreate(BaseModel):
    api_key: str = Field(..., min_length=8, max_length=500)
    label: str = Field(default="MiroMind API key", max_length=80)
    make_default: bool = True


class ApiKeyOut(BaseModel):
    id: str
    provider: str
    label: str
    fingerprint: str
    last4: str
    is_default: bool
    created_at: datetime
    last_used_at: datetime | None


@router.get("")
async def get_me(request: Request) -> dict[str, object]:
    user = await require_user(request)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
    }


@router.get("/api-keys")
async def list_api_keys(request: Request) -> list[ApiKeyOut]:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    keys = await repo.list_api_keys(user_id=user.id)
    return [ApiKeyOut(**key.__dict__) for key in keys]


@router.post("/api-keys", status_code=201)
async def create_api_key(request: Request, body: ApiKeyCreate) -> ApiKeyOut:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    cipher = request.app.state.argus.key_cipher
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    if cipher is None:
        raise HTTPException(
            status_code=_HTTP_SERVER_ERROR,
            detail="api key encryption is not configured",
        )
    raw = body.api_key.strip()
    key = await repo.create_api_key(
        user_id=user.id,
        encrypted_key=cipher.encrypt(raw),
        fingerprint=cipher.fingerprint(raw),
        last4=cipher.last4(raw),
        label=body.label,
        make_default=body.make_default,
    )
    return ApiKeyOut(**key.__dict__)


@router.delete("/api-keys/{key_id}", status_code=204)
async def delete_api_key(request: Request, key_id: str) -> None:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    deleted = await repo.revoke_api_key(user_id=user.id, key_id=key_id)
    if not deleted:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="api key not found")
