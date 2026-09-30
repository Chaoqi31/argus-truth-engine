"""WebSocket /ws/jobs/{id}: a snapshot of the job, then every change to it."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from argus.api.app import create_app
from argus.config import Settings
from argus.models.job import Job


@pytest.fixture
def app_under_test(tmp_path: Path, db_url: str) -> FastAPI:
    settings = Settings(
        miromind_api_key="sk_test",
        db_url=db_url,
        storage_root=str(tmp_path / "uploads"),
    )
    return create_app(settings=settings)


def _store(app: FastAPI, job: Job) -> None:
    asyncio.run(app.state.argus.repo.save_job(job))


def test_a_finished_job_arrives_as_a_snapshot_and_closes(app_under_test: FastAPI) -> None:
    _store(app_under_test, Job(id="j1", input_mode="text", input_text="t", status="done"))

    with (
        TestClient(app_under_test) as client,
        client.websocket_connect("/ws/jobs/j1") as ws,
        pytest.raises(WebSocketDisconnect),
    ):
        frame = json.loads(ws.receive_text())
        assert frame["type"] == "snapshot"
        assert (frame["job"]["id"], frame["job"]["status"]) == ("j1", "done")
        ws.receive_text()


def test_an_unknown_job_closes_with_a_policy_violation(app_under_test: FastAPI) -> None:
    with (
        TestClient(app_under_test) as client,
        client.websocket_connect("/ws/jobs/nope") as ws,
        pytest.raises(WebSocketDisconnect) as closed,
    ):
        ws.receive_text()
    assert closed.value.code == 1008
