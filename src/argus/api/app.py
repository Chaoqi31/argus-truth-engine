"""FastAPI app factory."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from argus.api.account import router as account_router
from argus.api.auth import SupabaseJwtVerifier
from argus.api.deps import AppState
from argus.api.jobs import router as jobs_router
from argus.api.ws import router as ws_router
from argus.config import Settings
from argus.db.repository import JobRepository
from argus.db.session import create_engine_from_url, sessionmaker_from_engine
from argus.orchestrator.checkpointer import build_checkpointer
from argus.security.api_keys import ApiKeyCipher
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
        RedisPubSubBus(
            settings.redis_url,
            max_history_events=settings.trace_history_max_events,
            history_ttl_s=settings.trace_history_ttl_s,
        )
        if settings.redis_url
        else InProcessBus(
            max_history_events=settings.trace_history_max_events,
            history_ttl_s=settings.trace_history_ttl_s,
        )
    )
    key_cipher = (
        ApiKeyCipher(settings.api_key_encryption_secret)
        if settings.api_key_encryption_secret
        else None
    )

    return AppState(
        settings=settings,
        repo=repo,
        storage=storage,
        trace_bus=trace_bus,
        db_engine=engine,
        auth_verifier=SupabaseJwtVerifier(settings) if settings.supabase_url else None,
        key_cipher=key_cipher,
    )


def create_app(*, settings: Settings) -> FastAPI:
    state = _build_state(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        async with AsyncExitStack() as stack:
            # Build the LangGraph checkpointer ONCE for the whole process —
            # all audit_* / audit_resume calls share this saver. Avoids a
            # per-job DDL roundtrip + connection setup, and prevents the
            # `database is locked` storm that happens on SQLite when each
            # in-flight job opens its own connection.
            state.checkpointer = await stack.enter_async_context(
                build_checkpointer(state.settings)
            )

            # Register the rest of the teardowns on the same exit stack so
            # they fire regardless of where startup might raise (mark-zombie
            # below, lifespan body, or shutdown). LIFO order at exit:
            #   db_engine.dispose() → trace_bus.close() → checkpointer.__aexit__()
            if state.db_engine is not None:
                stack.push_async_callback(state.db_engine.dispose)
            close_bus = getattr(state.trace_bus, "close", None)
            if close_bus is not None:
                stack.push_async_callback(close_bus)

            # Startup: mark abandoned jobs (worker died mid-flight) as interrupted
            if state.repo is not None:
                n_flipped = await state.repo.mark_running_as_interrupted()
                if n_flipped:
                    from argus.log import log
                    log.info("startup.zombie_jobs_marked_interrupted",
                             count=n_flipped)
            yield

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
    app.include_router(account_router)
    app.include_router(ws_router)

    return app


def _cors_origins(settings: Settings) -> list[str]:
    raw = settings.cors_allow_origins
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["http://localhost:3000", "http://127.0.0.1:3000"]
