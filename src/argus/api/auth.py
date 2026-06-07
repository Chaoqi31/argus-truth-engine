"""Authentication helpers for user-scoped Argus APIs."""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, Request, WebSocket

from argus.config import Settings

_HTTP_UNAUTHORIZED = 401
_HTTP_SERVER_ERROR = 500


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None


@dataclass(frozen=True)
class AuthContext:
    user: AuthUser | None = None
    service: bool = False


class SupabaseJwtVerifier:
    """Verify Supabase Auth JWTs with the project's JWKS endpoint."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jwks: dict[str, Any] | None = None
        self._jwks_fetched_at = 0.0

    async def verify(self, token: str) -> AuthUser:
        if not self._settings.supabase_url:
            raise HTTPException(
                status_code=_HTTP_SERVER_ERROR,
                detail="Supabase auth is not configured.",
            )
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
        if alg == "HS256" and self._settings.supabase_anon_key:
            return await self._verify_with_supabase_user_endpoint(token)
        kid = header.get("kid")
        if not isinstance(kid, str):
            if self._settings.supabase_anon_key:
                return await self._verify_with_supabase_user_endpoint(token)
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="invalid token")

        jwk = await self._get_jwk(kid)
        if jwk is None:
            await self._refresh_jwks(force=True)
            jwk = await self._get_jwk(kid)
        if jwk is None:
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="unknown token key")

        try:
            key = jwt.PyJWK.from_dict(jwk).key
            claims = jwt.decode(
                token,
                key=key,
                algorithms=["RS256", "ES256", "EdDSA"],
                audience=self._settings.supabase_jwt_audience,
                issuer=_issuer(self._settings),
            )
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="invalid token") from exc

        sub = claims.get("sub")
        if not isinstance(sub, str) or not sub:
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="invalid token subject")

        metadata = claims.get("user_metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        return AuthUser(
            id=sub,
            email=_claim_str(claims.get("email")),
            name=_claim_str(metadata.get("full_name") or metadata.get("name")),
            avatar_url=_claim_str(metadata.get("avatar_url") or metadata.get("picture")),
        )

    async def _verify_with_supabase_user_endpoint(self, token: str) -> AuthUser:
        url = f"{self._settings.supabase_url.rstrip('/')}/auth/v1/user"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": self._settings.supabase_anon_key,
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="invalid token")
        data = resp.json()
        if not isinstance(data, dict):
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="invalid token")
        user_id = data.get("id")
        if not isinstance(user_id, str) or not user_id:
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="invalid token")
        metadata = data.get("user_metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        return AuthUser(
            id=user_id,
            email=_claim_str(data.get("email")),
            name=_claim_str(metadata.get("full_name") or metadata.get("name")),
            avatar_url=_claim_str(metadata.get("avatar_url") or metadata.get("picture")),
        )

    async def _get_jwk(self, kid: str) -> dict[str, Any] | None:
        jwks = await self._refresh_jwks()
        keys = jwks.get("keys")
        if not isinstance(keys, list):
            return None
        for key in keys:
            if isinstance(key, dict) and key.get("kid") == kid:
                return key
        return None

    async def _refresh_jwks(self, *, force: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        ttl = self._settings.supabase_jwks_cache_ttl_s
        if self._jwks is not None and not force and now - self._jwks_fetched_at < ttl:
            return self._jwks

        url = f"{self._settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="auth keys unavailable")
        data = resp.json()
        if not isinstance(data, dict):
            raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="auth keys unavailable")
        self._jwks = data
        self._jwks_fetched_at = now
        return data


async def auth_context_from_request(request: Request) -> AuthContext:
    token = _bearer_token(request.headers.get("authorization"))
    return await _auth_context(
        token=token,
        settings=request.app.state.argus.settings,
        verifier=request.app.state.argus.auth_verifier,
    )


async def auth_context_from_websocket(websocket: WebSocket, token: str | None) -> AuthContext:
    header_token = _bearer_token(websocket.headers.get("authorization"))
    query_token = token.strip() if token else None
    return await _auth_context(
        token=header_token or query_token,
        settings=websocket.app.state.argus.settings,
        verifier=websocket.app.state.argus.auth_verifier,
    )


async def require_user(request: Request) -> AuthUser:
    ctx = await auth_context_from_request(request)
    if ctx.user is None:
        raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="login required")
    await _sync_user(request, ctx.user)
    return ctx.user


async def _auth_context(
    *,
    token: str | None,
    settings: Settings,
    verifier: Any | None,
) -> AuthContext:
    if token and settings.api_token and token == settings.api_token:
        return AuthContext(service=True)

    if token:
        active_verifier = verifier or SupabaseJwtVerifier(settings)
        return AuthContext(user=await active_verifier.verify(token))

    if settings.auth_required:
        raise HTTPException(status_code=_HTTP_UNAUTHORIZED, detail="login required")
    return AuthContext()


async def _sync_user(request: Request, user: AuthUser) -> None:
    repo = request.app.state.argus.repo
    if repo is not None:
        await repo.upsert_user(user)


def _bearer_token(value: str | None) -> str | None:
    if not value:
        return None
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _issuer(settings: Settings) -> str:
    return f"{settings.supabase_url.rstrip('/')}/auth/v1"


def _claim_str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
