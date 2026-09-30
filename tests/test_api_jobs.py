"""Tests for POST /jobs (upload + background audit kickoff) and GET /jobs/{id}."""
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from argus.api.app import create_app
from argus.audit import Run
from argus.config import Settings
from argus.models.job import Finished

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"

HTTP_OK = 200
HTTP_ACCEPTED = 202
HTTP_BAD_REQUEST = 400
HTTP_PAYLOAD_TOO_LARGE = 413
HTTP_NOT_FOUND = 404
HTTP_UNSUPPORTED = 415
HTTP_TOO_MANY_REQUESTS = 429


@pytest.fixture
def app_under_test(tmp_path: Path, db_url: str) -> FastAPI:
    settings = Settings(
        miromind_api_key="sk_test",
        db_url=db_url,
        storage_root=str(tmp_path / "uploads"),
    )
    return create_app(settings=settings)


def _finishing_audit(captured: dict[str, Any] | None = None) -> Any:
    """Stands in for the pipeline: keeps what the run was handed, then ends it."""

    async def work(run: Run) -> None:
        if captured is not None:
            captured["job"] = run.job
            captured["model"] = run.llm.access.model
        run.record(Finished(status="done", completed_at=datetime.utcnow()))

    return work


async def _wait_for_status(client: AsyncClient, job_id: str, status: str) -> dict[str, Any]:
    async with asyncio.timeout(10):
        while True:
            got = await client.get(f"/jobs/{job_id}")
            if got.status_code == HTTP_OK and got.json().get("status") == status:
                return got.json()
            await asyncio.sleep(0.05)


async def test_post_jobs_accepts_pdf_and_returns_job_id(app_under_test: FastAPI) -> None:
    """The upload is stored, the job starts, and its PDF stays retrievable."""
    with patch("argus.api.runner._audit", new=_finishing_audit()):
        async with AsyncClient(
            transport=ASGITransport(app=app_under_test), base_url="http://test"
        ) as client:
            with FIXTURE_PDF.open("rb") as fh:
                resp = await client.post(
                    "/jobs",
                    files={"pdf": ("sample-report.pdf", fh, "application/pdf")},
                )
            assert resp.status_code == HTTP_ACCEPTED, resp.text
            job_id = resp.json()["job_id"]
            assert job_id

            assert (await _wait_for_status(client, job_id, "done"))["input_mode"] == "pdf"
            pdf_resp = await client.get(f"/jobs/{job_id}/pdf")
            assert pdf_resp.status_code == HTTP_OK
            assert pdf_resp.content.startswith(b"%PDF")


async def test_post_jobs_passes_content_domain_to_pdf_pipeline(app_under_test: FastAPI) -> None:
    with patch("argus.api.runner._audit", new=_finishing_audit()):
        async with AsyncClient(
            transport=ASGITransport(app=app_under_test), base_url="http://test"
        ) as client:
            with FIXTURE_PDF.open("rb") as fh:
                resp = await client.post(
                    "/jobs",
                    data={"content_domain": "finance"},
                    files={"pdf": ("sample-report.pdf", fh, "application/pdf")},
                )
            assert resp.status_code == HTTP_ACCEPTED, resp.text
            job_id = resp.json()["job_id"]

            done = await _wait_for_status(client, job_id, "done")
            assert done["content_domain"] == "finance"


async def test_post_text_passes_miromind_model_to_pipeline(app_under_test: FastAPI) -> None:
    captured: dict[str, Any] = {}
    body = {
        "text": "This is a sufficiently long text input for live audit testing.",
        "miromind_model": "mirothinker-1-7-deepresearch-mini",
    }
    with patch("argus.api.runner._audit", new=_finishing_audit(captured)):
        async with AsyncClient(
            transport=ASGITransport(app=app_under_test), base_url="http://test"
        ) as client:
            resp = await client.post("/jobs/text", json=body)
            assert resp.status_code == HTTP_ACCEPTED, resp.text

            await _wait_for_status(client, resp.json()["job_id"], "done")
    assert captured["model"] == "mirothinker-1-7-deepresearch-mini"
    assert captured["job"].input_text == body["text"]


async def test_post_text_rejects_unknown_miromind_model(app_under_test: FastAPI) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_under_test), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/jobs/text",
            json={
                "text": "This is a sufficiently long text input for live audit testing.",
                "miromind_model": "not-a-real-model",
            },
        )
    assert resp.status_code == HTTP_BAD_REQUEST
    assert "Unsupported MiroMind model" in resp.text


async def test_get_missing_job_returns_404(app_under_test: FastAPI) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_under_test), base_url="http://test"
    ) as client:
        resp = await client.get("/jobs/nope")
    assert resp.status_code == HTTP_NOT_FOUND


async def test_post_text_rejects_when_active_job_limit_reached(
    app_under_test: FastAPI,
) -> None:
    app_under_test.state.argus.settings.max_active_jobs = 1
    started = asyncio.Event()
    release = asyncio.Event()

    async def _slow_audit(_run: Run) -> None:
        started.set()
        await release.wait()

    body = {"text": "This is a sufficiently long text input for live audit testing."}
    with patch("argus.api.runner._audit", new=_slow_audit):
        async with AsyncClient(
            transport=ASGITransport(app=app_under_test), base_url="http://test"
        ) as client:
            first = await client.post("/jobs/text", json=body)
            assert first.status_code == HTTP_ACCEPTED, first.text
            await asyncio.wait_for(started.wait(), timeout=1)

            second = await client.post("/jobs/text", json=body)
            assert second.status_code == HTTP_TOO_MANY_REQUESTS
            assert "Too many active audits" in second.text

            release.set()


async def test_post_rejects_non_pdf(app_under_test: FastAPI) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_under_test), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/jobs",
            files={"pdf": ("evil.txt", b"not a pdf", "text/plain")},
        )
    assert resp.status_code == HTTP_UNSUPPORTED


async def test_post_rejects_oversized_upload(app_under_test: FastAPI) -> None:
    app_under_test.state.argus.settings.max_upload_bytes = 3
    async with AsyncClient(
        transport=ASGITransport(app=app_under_test), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/jobs",
            files={"pdf": ("sample-report.pdf", b"%PDF-1.4", "application/pdf")},
        )
    assert resp.status_code == HTTP_PAYLOAD_TOO_LARGE
