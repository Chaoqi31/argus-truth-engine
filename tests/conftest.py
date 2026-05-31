"""Pytest fixtures shared across the test suite."""
from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator

# WeasyPrint on macOS + Homebrew needs DYLD_LIBRARY_PATH for Pango/Cairo.
# Safe no-op on Linux / CI.
if sys.platform == "darwin":
    os.environ.setdefault("DYLD_LIBRARY_PATH", "/opt/homebrew/lib")

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from argus.db.models import Base


@pytest.fixture(autouse=True)
def _hermetic_api_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests must never use real API keys or make network calls.

    A developer's shell or local .env may set ARGUS_MIROMIND_API_KEY /
    ARGUS_CHEAP_LLM_API_KEY (so the live app works locally). If those leak into
    Settings() during tests, the orchestrator builds real clients and the
    cheap-LLM nodes (planner, atomizer, checkworthiness, consistency, reporter)
    make real DeepSeek calls — non-deterministic and slow. Force them empty so
    Settings() resolves to "" (an env var overrides the .env file); tests that
    need a client pass one explicitly (init kwargs override env).
    """
    monkeypatch.setenv("ARGUS_MIROMIND_API_KEY", "")
    monkeypatch.setenv("ARGUS_CHEAP_LLM_API_KEY", "")


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
