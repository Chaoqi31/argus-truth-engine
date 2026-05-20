"""Tests for the DB session factory."""
from __future__ import annotations

import pytest

from argus.db.session import (
    create_engine_from_url,
    sessionmaker_from_engine,
)


@pytest.mark.parametrize(
    "url",
    [
        "sqlite+aiosqlite:///:memory:",
        "postgresql+asyncpg://argus:argus@localhost:5436/argus",
    ],
)
def test_create_engine_accepts_known_drivers(url: str) -> None:
    engine = create_engine_from_url(url)
    assert engine.url.get_backend_name() in {"sqlite", "postgresql"}


async def test_sessionmaker_yields_working_session() -> None:
    engine = create_engine_from_url("sqlite+aiosqlite:///:memory:")
    smaker = sessionmaker_from_engine(engine)
    async with smaker() as session:
        assert session.is_active
    await engine.dispose()
