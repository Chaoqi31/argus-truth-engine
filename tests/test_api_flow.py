"""End-to-end audit through the real HTTP and WebSocket surface.

A real uvicorn server runs the app against a SQLite file and the fake LLM
server, so the test exercises upload, the claim review pause, resume,
persistence, and the live job socket the way the web UI does: one connection
opened before the pause stays open across it.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import websockets

from argus.api.app import create_app
from argus.config import Settings
from tests.fake_llm import PDF_C1, PDF_C2
from tests.golden import assert_golden, fake_llm_server, serve, snapshot

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"
KEY = {"X-Miromind-Key": "fake"}


def _settings(tmp_path: Path, llm_url: str, db_url: str) -> Settings:
    return Settings(
        miromind_base_url=f"{llm_url}/v1",
        miromind_retry_base_delay_s=0.001,
        cheap_llm_api_key="fake",
        cheap_llm_base_url=llm_url,
        db_url=db_url,
        storage_root=str(tmp_path / "uploads"),
        self_hosted=True,
        cache_enabled=False,
    )


async def _next_event(ws: Any, frames: list[dict[str, Any]], kind: str) -> dict[str, Any]:
    """Read frames until one carries an event of ``kind``."""
    while True:
        frame = json.loads(await ws.recv())
        assert frame["type"] == "event", frame
        frames.append(frame)
        if frame["event"]["type"] == kind:
            return frame["event"]


async def _audit_with_review(host: str) -> tuple[str, dict[str, Any]]:
    """Upload the fixture PDF, keep only the first claim at review, run to completion."""
    frames: list[dict[str, Any]] = []
    async with httpx.AsyncClient(base_url=f"http://{host}", timeout=30) as http:
        with FIXTURE_PDF.open("rb") as fh:
            resp = await http.post(
                "/jobs", files={"pdf": ("sample-report.pdf", fh, "application/pdf")}, headers=KEY
            )
        assert resp.status_code == 202, resp.text
        job_id = resp.json()["job_id"]

        url = f"ws://{host}/ws/jobs/{job_id}"
        async with asyncio.timeout(60), websockets.connect(url) as ws:
            snapshot_frame = json.loads(await ws.recv())
            assert snapshot_frame["type"] == "snapshot"
            assert snapshot_frame["job"]["id"] == job_id

            paused = snapshot_frame["job"]
            if paused["status"] != "awaiting_review":
                paused = await _next_event(ws, frames, "review_ready")
            claims = paused["claims"]
            assert [c["text"] for c in claims] == [PDF_C1, PDF_C2]

            keep = claims[0]["id"]
            resp = await http.post(
                f"/jobs/{job_id}/claims/select", json={"selected_claim_ids": [keep]}, headers=KEY
            )
            assert resp.status_code == 200, resp.text
            # The same connection carries the run that resumes the job.
            await _next_event(ws, frames, "finished")

        job = (await http.get(f"/jobs/{job_id}")).json()
        assert job["status"] == "done"
        assert {f["claim_id"] for f in job["findings"]} == {keep}

        listing = (await http.get("/jobs")).json()["jobs"]
        assert [(j["id"], j["status"]) for j in listing] == [(job_id, "done")]
        pdf = await http.get(f"/jobs/{job_id}/pdf")
        assert pdf.content.startswith(b"%PDF")

    return job_id, job


async def test_pdf_audit_with_claim_review_matches_golden(tmp_path: Path, db_url: str) -> None:
    with fake_llm_server() as (llm_url, fake):
        settings = _settings(tmp_path, llm_url, db_url)
        with serve(create_app(settings=settings)) as host:
            _, job = await _audit_with_review(host)
    assert_golden("api_pdf_review", snapshot(job, None, fake))


async def test_finished_audit_reads_back_identically_after_restart(
    tmp_path: Path, db_url: str
) -> None:
    with fake_llm_server() as (llm_url, _):
        settings = _settings(tmp_path, llm_url, db_url)
        with serve(create_app(settings=settings)) as host:
            job_id, live = await _audit_with_review(host)
        with serve(create_app(settings=settings)) as host:
            async with httpx.AsyncClient(base_url=f"http://{host}") as http:
                stored = (await http.get(f"/jobs/{job_id}")).json()
    assert stored == live
