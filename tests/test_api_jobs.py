"""Tests for POST /jobs (upload + background audit kickoff) and GET /jobs/{id}."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from argus.api.app import create_app
from argus.config import Settings
from argus.models.domain import Job

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"

HTTP_OK = 200
HTTP_ACCEPTED = 202
HTTP_PAYLOAD_TOO_LARGE = 413
HTTP_NOT_FOUND = 404
HTTP_UNSUPPORTED = 415


@pytest.fixture
def app_under_test(tmp_path: Path) -> FastAPI:
    settings = Settings(
        miromind_api_key="sk_test",
        db_url=None,
        redis_url=None,
        storage_root=str(tmp_path / "uploads"),
    )
    return create_app(settings=settings)


async def test_post_jobs_accepts_pdf_and_returns_job_id(app_under_test: FastAPI) -> None:
    """We patch audit_pdf to skip the real pipeline; just check accept + id."""
    fake_job = Job(id="job_fake", pdf_path="x.pdf", status="done")

    async def _fake_audit(**kw: Any) -> Job:
        await asyncio.sleep(0)
        Path(str(kw["output_path"])).write_text(fake_job.model_dump_json())
        return fake_job

    with patch("argus.api.runner.audit_pdf", new=_fake_audit):
        async with AsyncClient(
            transport=ASGITransport(app=app_under_test), base_url="http://test"
        ) as client:
            with FIXTURE_PDF.open("rb") as fh:
                resp = await client.post(
                    "/jobs",
                    files={"pdf": ("sample-report.pdf", fh, "application/pdf")},
                )
            assert resp.status_code == HTTP_ACCEPTED, resp.text
            body = resp.json()
            job_id = body["job_id"]
            assert job_id

            # Poll GET until the in-memory runner finishes.
            got = None
            for _ in range(40):
                got = await client.get(f"/jobs/{job_id}")
                if got.status_code == HTTP_OK and got.json().get("status") == "done":
                    break
                await asyncio.sleep(0.05)
            assert got is not None
            assert got.status_code == HTTP_OK
            assert got.json()["status"] == "done"

            pdf_resp = await client.get(f"/jobs/{job_id}/pdf")
            assert pdf_resp.status_code == HTTP_OK
            assert pdf_resp.content.startswith(b"%PDF")


async def test_get_missing_job_returns_404(app_under_test: FastAPI) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_under_test), base_url="http://test"
    ) as client:
        resp = await client.get("/jobs/nope")
    assert resp.status_code == HTTP_NOT_FOUND


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
