"""Database engine + session factory.

Callers build an engine once and reuse the sessionmaker. Tests use the
in-memory SQLite engine fixture from conftest; production uses Postgres.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def create_engine_from_url(db_url: str, *, echo: bool = False) -> AsyncEngine:
    """Build an async engine from a URL string."""
    return create_async_engine(db_url, echo=echo, future=True)


def sessionmaker_from_engine(
    engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    """Default sessionmaker config: don't expire on commit (cleaner reads)."""
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
