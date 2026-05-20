"""Smoke test: API starts and /healthz returns 200."""
from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from argus.api.app import create_app
from argus.config import Settings


@pytest.fixture
def app_under_test(tmp_path: Any) -> FastAPI:
    settings = Settings(
        miromind_api_key="sk_test",
        db_url=None,
        redis_url=None,
        storage_root=str(tmp_path / "storage"),
    )
    return create_app(settings=settings)


async def test_healthz_returns_200(app_under_test: FastAPI) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_under_test), base_url="http://test"
    ) as client:
        resp = await client.get("/healthz")
    assert resp.status_code == 200  # noqa: PLR2004
    assert resp.json() == {"status": "ok"}
