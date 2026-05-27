"""Backend-agnostic checkpointer factory for LangGraph.

Chooses ``AsyncSqliteSaver`` or ``AsyncPostgresSaver`` based on the
``db_url`` scheme. Returns an async context manager — callers should
``async with build_checkpointer(settings) as saver: ...``.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver

from argus.config import Settings
from argus.log import log


@asynccontextmanager
async def build_checkpointer(
    settings: Settings,
) -> AsyncIterator[BaseCheckpointSaver[Any] | None]:
    """Yield a configured async checkpointer, or None if db_url is unset.

    A ``None`` checkpointer means the graph runs without persistence —
    used by CLI mode and tests that don't need resume.
    """
    if not settings.db_url:
        log.info("checkpointer.disabled", reason="no db_url")
        yield None
        return

    url = settings.db_url
    if url.startswith("sqlite"):
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        # AsyncSqliteSaver takes a sqlite file path; extract from db_url
        # sqlite+aiosqlite:///path/to/db -> path/to/db
        path = url.split("///", 1)[-1] if "///" in url else ":memory:"
        async with AsyncSqliteSaver.from_conn_string(path) as saver:
            await saver.setup()
            log.info("checkpointer.ready", backend="sqlite", path=path)
            yield saver
    elif "postgres" in url:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        # AsyncPostgresSaver wants a plain postgres:// URL, not postgresql+asyncpg://
        pg_url = url.replace("postgresql+asyncpg://", "postgresql://")
        async with AsyncPostgresSaver.from_conn_string(pg_url) as saver:
            await saver.setup()
            log.info("checkpointer.ready", backend="postgres")
            yield saver
    else:
        log.warning("checkpointer.unsupported_url", url=url[:30])
        yield None
