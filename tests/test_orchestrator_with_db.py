"""Verify the orchestrator persists the Job via JobRepository when repo is set."""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.config import Settings
from argus.db.repository import JobRepository
from argus.orchestrator import audit_pdf
from tests._helpers.mock_miromind import StreamRouter, completed, msg, tool

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"


def _planner_json() -> str:
    return json.dumps(
        {
            "claims": [
                {
                    "id": "c1",
                    "text": "Smith (2021) X.",
                    "page": 1,
                    "span": [0, 16],
                    "type": "citation",
                    "importance": "high",
                    "extracted_metadata": {"authors": ["Smith"], "year": 2021},
                }
            ]
        }
    )


def _verifier_json() -> str:
    return json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.9,
            "summary": "No record.",
            "evidence": [
                {"source_type": "crossref", "url": "https://api.crossref.org/x", "snippet": "{}"}
            ],
        }
    )


def _alignment_json() -> str:
    return json.dumps(
        {
            "verdict": "uncertain",
            "confidence": 0.4,
            "summary": "Source not retrievable.",
            "evidence": [{"source_type": "web_page", "url": None, "snippet": "404"}],
        }
    )


def _reporter_json() -> str:
    return json.dumps(
        {"executive_summary_md": "**1 issue**.", "ranked_finding_ids": []}
    )


async def test_orchestrator_persists_to_db_when_repo_provided(
    tmp_path: Path, sqlite_engine: object
) -> None:
    smaker = async_sessionmaker(sqlite_engine, expire_on_commit=False)
    repo = JobRepository(smaker)

    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "citation_verifier",
        [tool("web_search", {"q": "Smith"}, 2), msg(_verifier_json()), completed(tokens=60)],
    )
    router.add(
        "citation_alignment",
        [msg(_alignment_json()), completed(tokens=40)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
        repo=repo,
    )

    # File still written (existing behavior preserved).
    assert out.exists()

    # And DB has the same job.
    loaded = await repo.get_job(job.id)
    assert loaded is not None
    assert loaded.id == job.id
    assert len(loaded.findings) == len(job.findings)
    assert loaded.audit_report_md == job.audit_report_md


async def test_orchestrator_skips_db_when_repo_not_provided(tmp_path: Path) -> None:
    """No repo → file output only, no exceptions."""
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "citation_verifier",
        [msg(_verifier_json()), completed(tokens=60)],
    )
    router.add(
        "citation_alignment",
        [msg(_alignment_json()), completed(tokens=40)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
    )
    assert out.exists()
    assert job.id  # smoke
