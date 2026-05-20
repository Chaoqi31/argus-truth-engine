"""Pytest fixtures shared across the test suite."""
from __future__ import annotations

from collections.abc import AsyncIterator

import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine

from argus.db.models import Base


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
