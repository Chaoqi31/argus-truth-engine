"""FastAPI app factory."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from argus.api.deps import AppState
from argus.api.jobs import router as jobs_router
from argus.api.ws import router as ws_router
from argus.config import Settings
from argus.hitl import ReviewGate
from argus.db.repository import JobRepository
from argus.db.session import create_engine_from_url, sessionmaker_from_engine
from argus.storage.local_fs import LocalFsStorage
from argus.trace_bus.base import TraceBus
from argus.trace_bus.in_process import InProcessBus
from argus.trace_bus.redis_pubsub import RedisPubSubBus


def _build_state(settings: Settings) -> AppState:
    storage = LocalFsStorage(Path(settings.storage_root))

    repo: JobRepository | None = None
    engine = None
    if settings.db_url:
        engine = create_engine_from_url(settings.db_url)
        repo = JobRepository(sessionmaker_from_engine(engine))

    trace_bus: TraceBus = (
        RedisPubSubBus(settings.redis_url) if settings.redis_url else InProcessBus()
    )

    return AppState(
        settings=settings,
        repo=repo,
        storage=storage,
        trace_bus=trace_bus,
        review_gate=ReviewGate(),
        db_engine=engine,
    )


def create_app(*, settings: Settings) -> FastAPI:
    state = _build_state(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            close_bus = getattr(state.trace_bus, "close", None)
            if close_bus is not None:
                await close_bus()
            if state.db_engine is not None:
                await state.db_engine.dispose()

    app = FastAPI(
        title="Argus API",
        version="0.0.1",
        lifespan=lifespan,
    )

    app.state.argus = state

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(settings),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(jobs_router)
    app.include_router(ws_router)

    return app


def _cors_origins(settings: Settings) -> list[str]:
    raw = settings.cors_allow_origins
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["http://localhost:3000", "http://127.0.0.1:3000"]
