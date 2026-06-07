"""FastAPI DI helpers.

A single AppState dataclass holds the shared, app-scoped collaborators
(settings, repo, storage, trace bus). It's attached to ``app.state.argus``
in ``create_app`` so endpoints can pull it via ``request.app.state.argus``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncEngine

from argus.config import Settings
from argus.db.repository import JobRepository
from argus.security.api_keys import ApiKeyCipher
from argus.storage.base import Storage
from argus.trace_bus.base import TraceBus

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver


@dataclass
class AppState:
    settings: Settings
    repo: JobRepository | None
    storage: Storage
    trace_bus: TraceBus
    db_engine: AsyncEngine | None = None
    auth_verifier: Any | None = None
    key_cipher: ApiKeyCipher | None = None
    # Pre-built in FastAPI lifespan and reused for every audit_* call.
    # None when running without a DB (e.g. ad-hoc test setup) — entry
    # functions fall back to building their own per-call.
    checkpointer: BaseCheckpointSaver[Any] | None = None


def get_state(request: Request) -> AppState:
    """FastAPI dependency that returns the app-scoped AppState."""
    state: AppState = request.app.state.argus
    return state
