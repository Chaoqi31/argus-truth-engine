"""Alembic environment for Argus.

We use the async engine API but Alembic runs migrations synchronously,
so we run the async ops via asyncio.run().
"""
from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from alembic.ddl.impl import DefaultImpl
from sqlalchemy import Column, MetaData, PrimaryKeyConstraint, String, Table
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from argus.db.models import Base
from argus.db.session import create_engine_from_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _version_table_impl(
    self: DefaultImpl,
    *,
    version_table: str,
    version_table_schema: str | None,
    version_table_pk: bool,
    **_kw: object,
) -> Table:
    """Argus revision ids are longer than Alembic's default varchar(32)."""
    vt = Table(
        version_table,
        MetaData(),
        Column("version_num", String(128), nullable=False),
        schema=version_table_schema,
    )
    if version_table_pk:
        vt.append_constraint(
            PrimaryKeyConstraint("version_num", name=f"{version_table}_pkc")
        )
    return vt


DefaultImpl.version_table_impl = _version_table_impl  # type: ignore[method-assign]


def _resolved_db_url() -> str:
    # CLI override > env > alembic.ini default
    return (
        os.environ.get("ARGUS_DB_URL")
        or config.get_main_option("sqlalchemy.url")
        or "sqlite+aiosqlite:///./local.db"
    )


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (renders SQL only)."""
    context.configure(
        url=_resolved_db_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine: AsyncEngine = create_engine_from_url(_resolved_db_url())
    async with engine.begin() as conn:
        await conn.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
