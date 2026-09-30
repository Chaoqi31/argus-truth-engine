"""User account endpoints."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr

from argus.api.auth import require_user
from argus.api.deps import AppState
from argus.llm.miromind import MiroMindAccess, MiroMindError

router = APIRouter(prefix="/me", tags=["account"])

_HTTP_SERVER_ERROR = 500
_HTTP_NOT_FOUND = 404
_HTTP_BAD_REQUEST = 400


class ApiKeyCreate(BaseModel):
    api_key: str = Field(..., min_length=8, max_length=500)
    label: str = Field(default="MiroMind API key", max_length=80)
    make_default: bool = True


class ApiKeyPatch(BaseModel):
    label: str | None = Field(default=None, max_length=80)
    make_default: bool | None = None


class ApiKeyTest(BaseModel):
    api_key: str | None = Field(default=None, min_length=8, max_length=500)
    key_id: str | None = None


class ApiKeyTestOut(BaseModel):
    ok: bool
    message: str
    response_id: str | None = None


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


@router.patch("/api-keys/{key_id}")
async def update_api_key(request: Request, key_id: str, body: ApiKeyPatch) -> ApiKeyOut:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    updated = await repo.update_api_key(
        user_id=user.id,
        key_id=key_id,
        label=body.label,
        make_default=body.make_default,
    )
    if updated is None:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="api key not found")
    return ApiKeyOut(**updated.__dict__)


@router.post("/api-keys/test")
async def test_api_key(request: Request, body: ApiKeyTest) -> ApiKeyTestOut:
    user = await require_user(request)
    raw = (body.api_key or "").strip()
    if not raw and body.key_id:
        repo = request.app.state.argus.repo
        cipher = request.app.state.argus.key_cipher
        if repo is None:
            raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
        if cipher is None:
            raise HTTPException(
                status_code=_HTTP_SERVER_ERROR,
                detail="api key encryption is not configured",
            )
        encrypted = await repo.get_api_key_ciphertext_by_id(user_id=user.id, key_id=body.key_id)
        if encrypted is None:
            raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="api key not found")
        raw = cipher.decrypt(encrypted)
    if not raw:
        raise HTTPException(status_code=_HTTP_BAD_REQUEST, detail="api key required")
    return await _test_miromind_key(request.app.state.argus, raw)


@router.delete("/api-keys/{key_id}", status_code=204)
async def delete_api_key(request: Request, key_id: str) -> None:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    deleted = await repo.revoke_api_key(user_id=user.id, key_id=key_id)
    if not deleted:
        raise HTTPException(status_code=_HTTP_NOT_FOUND, detail="api key not found")


@router.delete("", status_code=204)
async def delete_account(request: Request) -> None:
    user = await require_user(request)
    repo = request.app.state.argus.repo
    if repo is None:
        raise HTTPException(status_code=_HTTP_SERVER_ERROR, detail="database is not configured")
    await repo.delete_user_data(user_id=user.id)


async def _test_miromind_key(state: AppState, api_key: str) -> ApiKeyTestOut:
    access = MiroMindAccess(api_key=SecretStr(api_key), model=state.settings.miromind_model)
    try:
        response_id = await state.transports.miromind.check_key(access)
    except MiroMindError as exc:
        return ApiKeyTestOut(ok=False, message=str(exc)[:240], response_id=None)
    return ApiKeyTestOut(ok=True, message="MiroMind accepted this key.", response_id=response_id)
