"""FastAPI DI helpers.

A single AppState dataclass holds the shared, app-scoped collaborators
(settings, repo, storage, trace bus). It's attached to ``app.state.argus``
in ``create_app`` so endpoints can pull it via ``request.app.state.argus``.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncEngine

from argus.config import Settings
from argus.db.repository import JobRepository
from argus.hitl import ReviewGate
from argus.storage.base import Storage
from argus.trace_bus.base import TraceBus


@dataclass
class AppState:
    settings: Settings
    repo: JobRepository | None
    storage: Storage
    trace_bus: TraceBus
    review_gate: ReviewGate
    db_engine: AsyncEngine | None = None


def get_state(request: Request) -> AppState:
    """FastAPI dependency that returns the app-scoped AppState."""
    state: AppState = request.app.state.argus
    return state
