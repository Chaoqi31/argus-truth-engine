"""End-to-end audit through the real HTTP and WebSocket surface.

A real uvicorn server runs the app against a SQLite file and the fake LLM
server, so the test exercises upload, the claim review pause, resume,
persistence, and trace replay the way the web UI does.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import websockets
from sqlalchemy.ext.asyncio import create_async_engine

from argus.api.app import create_app
from argus.config import Settings
from argus.db.models import Base
from tests.fake_llm import PDF_C1, PDF_C2
from tests.golden import assert_golden, fake_llm_server, serve, snapshot

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"
KEY = {"X-Miromind-Key": "fake"}


async def _create_schema(db_url: str) -> None:
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()


def _settings(tmp_path: Path, llm_url: str) -> Settings:
    return Settings(
        miromind_base_url=f"{llm_url}/v1",
        miromind_retry_base_delay_s=0.001,
        cheap_llm_api_key="fake",
        cheap_llm_base_url=llm_url,
        db_url=f"sqlite+aiosqlite:///{tmp_path / 'argus.db'}",
        storage_root=str(tmp_path / "uploads"),
        self_hosted=True,
        cache_enabled=False,
    )


async def _read_trace(
    host: str, job_id: str, *, until: str, after: int = 0
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    url = f"ws://{host}/ws/jobs/{job_id}/trace?after={after}"
    async with asyncio.timeout(30), websockets.connect(url) as ws:
        async for raw in ws:
            event = json.loads(raw)
            events.append(event)
            if event["kind"] == until:
                break
    return events


async def _settled_status(http: httpx.AsyncClient, job_id: str) -> str:
    """The job status once the runner has recorded the pause."""
    async with asyncio.timeout(10):
        while True:
            status: str = (await http.get(f"/jobs/{job_id}")).json()["status"]
            if status != "running":
                return status
            await asyncio.sleep(0.05)


async def _audit_with_review(host: str) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """Upload the fixture PDF, keep only the first claim at review, run to completion."""
    async with httpx.AsyncClient(base_url=f"http://{host}", timeout=30) as http:
        with FIXTURE_PDF.open("rb") as fh:
            resp = await http.post(
                "/jobs", files={"pdf": ("sample-report.pdf", fh, "application/pdf")}, headers=KEY
            )
        assert resp.status_code == 202, resp.text
        job_id = resp.json()["job_id"]

        before_review = await _read_trace(host, job_id, until="review_ready")
        review = before_review[-1]["payload"]
        assert [c["text"] for c in review["claims"]] == [PDF_C1, PDF_C2]

        paused = await _settled_status(http, job_id)
        assert paused == "interrupted"

        keep = review["claims"][0]["id"]
        resp = await http.post(
            f"/jobs/{job_id}/claims/select", json={"selected_claim_ids": [keep]}, headers=KEY
        )
        assert resp.status_code == 200, resp.text
        await _read_trace(host, job_id, until="finished", after=before_review[-1]["sequence"])

        job = (await http.get(f"/jobs/{job_id}")).json()
        assert job["status"] == "done"
        assert {f["claim_id"] for f in job["findings"]} == {keep}

        listing = (await http.get("/jobs")).json()["jobs"]
        assert [(j["id"], j["status"]) for j in listing] == [(job_id, "done")]
        pdf = await http.get(f"/jobs/{job_id}/pdf")
        assert pdf.content.startswith(b"%PDF")

    return job_id, await _read_trace(host, job_id, until="finished"), job


async def test_pdf_audit_with_claim_review_matches_golden(tmp_path: Path) -> None:
    with fake_llm_server() as (llm_url, fake):
        settings = _settings(tmp_path, llm_url)
        await _create_schema(settings.db_url or "")
        with serve(create_app(settings=settings)) as host:
            _, events, job = await _audit_with_review(host)
    assert_golden("api_pdf_review", snapshot(job, events, fake))


@pytest.mark.xfail(
    strict=True,
    reason=(
        "the 6-table mapping drops reasoning_chain, flags and parent_claim_id and "
        "rewrites step.trace_id; fixed by the document store"
    ),
)
async def test_finished_audit_reads_back_identically_after_restart(tmp_path: Path) -> None:
    with fake_llm_server() as (llm_url, _):
        settings = _settings(tmp_path, llm_url)
        await _create_schema(settings.db_url or "")
        with serve(create_app(settings=settings)) as host:
            job_id, _, live = await _audit_with_review(host)
        with serve(create_app(settings=settings)) as host:
            async with httpx.AsyncClient(base_url=f"http://{host}") as http:
                stored = (await http.get(f"/jobs/{job_id}")).json()
    assert stored == live
