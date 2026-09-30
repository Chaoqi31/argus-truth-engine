"""Pytest fixtures shared across the test suite."""
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from argus.db.models import Base
from argus.db.session import upgrade_schema


@pytest.fixture(autouse=True)
def _hermetic_api_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests must never use real API keys or make network calls.

    A developer's shell or local .env may set live-product config (API keys,
    auth enforcement, or a database URL). If those leak into Settings()
    during tests, anonymous API tests start returning 401s and offline
    pipeline tests can pause for review. Force hermetic values
    here; tests that need a setting pass one explicitly (init kwargs override env).
    """
    monkeypatch.setenv("ARGUS_MIROMIND_API_KEY", "")
    monkeypatch.setenv("ARGUS_CHEAP_LLM_API_KEY", "")
    monkeypatch.setenv("ARGUS_AUTH_REQUIRED", "false")
    monkeypatch.setenv("ARGUS_DB_URL", "")


@pytest.fixture
def db_url(tmp_path: Path) -> str:
    """A SQLite file with every migration applied, as `argus serve` leaves it."""
    url = f"sqlite+aiosqlite:///{tmp_path / 'argus.db'}"
    upgrade_schema(url)
    return url


@pytest_asyncio.fixture
async def test_sessionmaker() -> AsyncIterator[async_sessionmaker]:
    """Per-test in-memory SQLite with full schema applied."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest_asyncio.fixture
async def sqlite_engine() -> AsyncIterator[object]:
    """A fresh in-memory SQLite engine + schema for each test that asks."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()
