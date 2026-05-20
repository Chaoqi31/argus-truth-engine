"""WebSocket trace stream — history replay through the InProcessBus."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from argus.api.app import create_app
from argus.config import Settings
from argus.trace_bus.base import TraceEvent


@pytest.fixture
def app_under_test(tmp_path: Path) -> FastAPI:
    settings = Settings(
        miromind_api_key="sk_test",
        db_url=None,
        redis_url=None,
        storage_root=str(tmp_path / "uploads"),
    )
    return create_app(settings=settings)


def test_websocket_replays_history_then_closes_on_finished(
    app_under_test: FastAPI,
) -> None:
    bus = app_under_test.state.argus.trace_bus

    # Publish a complete trace BEFORE connecting; the subscription's history
    # snapshot covers it, and "finished" terminates the live iterator.
    async def seed() -> None:
        await bus.publish(TraceEvent(job_id="j1", sequence=1, kind="started"))
        await bus.publish(
            TraceEvent(
                job_id="j1",
                sequence=2,
                kind="step",
                payload={"agent": "planner"},
            )
        )
        await bus.publish(TraceEvent(job_id="j1", sequence=3, kind="finished"))

    asyncio.get_event_loop().run_until_complete(seed())

    client = TestClient(app_under_test)
    with client.websocket_connect("/ws/jobs/j1/trace") as ws:
        events: list[dict[str, object]] = []
        while True:
            raw = ws.receive_text()
            ev = json.loads(raw)
            events.append(ev)
            if ev["kind"] == "finished":
                break

    kinds = [e["kind"] for e in events]
    assert kinds == ["started", "step", "finished"]
    seqs = [e["sequence"] for e in events]
    assert seqs == [1, 2, 3]
    assert events[1]["payload"] == {"agent": "planner"}
