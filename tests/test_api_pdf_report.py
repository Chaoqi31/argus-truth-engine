"""End-to-end: build a Job in memory, expose it via the runner, fetch its PDF."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from argus.api.app import create_app
from argus.api.runner import JobRunner
from argus.config import Settings
from argus.models.domain import Job

SAMPLE = Path(__file__).parent.parent / "web" / "public" / "sample-findings.json"


@pytest.fixture
def app_with_sample_job(tmp_path: Path) -> tuple[FastAPI, str]:
    """Create an app with a pre-populated sample job in the runner."""
    settings = Settings(
        miromind_api_key="sk_test",
        db_url=None,
        redis_url=None,
        storage_root=str(tmp_path / "uploads"),
    )
    app = create_app(settings=settings)
    job = Job.model_validate(json.loads(SAMPLE.read_text()))
    runner = JobRunner(state=app.state.argus)

    # Manually populate the runner with the sample job
    from argus.api.runner import JobRecord
    record = JobRecord(job_id=job.id, status="done", result=job, pdf_key=None)
    runner.records[job.id] = record

    app.state.runner = runner
    return app, job.id


@pytest.mark.asyncio
async def test_report_pdf_endpoint_returns_pdf(app_with_sample_job: tuple[FastAPI, str]) -> None:
    app, job_id = app_with_sample_job
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get(f"/jobs/{job_id}/report.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_report_pdf_404_for_unknown_job(app_with_sample_job: tuple[FastAPI, str]) -> None:
    app, _ = app_with_sample_job
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/jobs/does-not-exist/report.pdf")
    assert r.status_code == 404
