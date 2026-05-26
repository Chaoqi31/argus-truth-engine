"""Pytest fixtures shared across the test suite."""
from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator

# WeasyPrint on macOS + Homebrew needs DYLD_LIBRARY_PATH for Pango/Cairo.
# Safe no-op on Linux / CI.
if sys.platform == "darwin":
    os.environ.setdefault("DYLD_LIBRARY_PATH", "/opt/homebrew/lib")

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from argus.db.models import Base


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
