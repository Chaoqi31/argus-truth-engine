"""The CLI end to end: `argus audit` against the fake LLM server."""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from typer.testing import CliRunner

from argus.cli import app
from tests.golden import fake_llm_server

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"


@contextmanager
def _fake_providers() -> Iterator[dict[str, str]]:
    """The environment `argus audit` reads, pointed at the fake providers."""
    with fake_llm_server() as (llm_url, _):
        yield {
            "ARGUS_MIROMIND_API_KEY": "fake",
            "ARGUS_MIROMIND_BASE_URL": f"{llm_url}/v1",
            "ARGUS_MIROMIND_RETRY_BASE_DELAY_S": "0.001",
            "ARGUS_CHEAP_LLM_API_KEY": "fake",
            "ARGUS_CHEAP_LLM_BASE_URL": llm_url,
            "ARGUS_DB_URL": "",
        }


def test_audit_writes_the_findings(tmp_path: Path) -> None:
    out = tmp_path / "findings.json"
    with _fake_providers() as env:
        result = CliRunner().invoke(
            app, ["audit", str(FIXTURE_PDF), "-o", str(out)], env=env
        )

    assert result.exit_code == 0, result.output
    job = json.loads(out.read_text())
    assert job["id"].startswith("job_")
    assert job["status"] == "done"
    assert job["findings"]
    assert job["claims_audited"] == len(job["claims"])


def test_audit_stops_at_the_budget(tmp_path: Path) -> None:
    out = tmp_path / "findings.json"
    with _fake_providers() as env:
        result = CliRunner().invoke(
            app,
            ["audit", str(FIXTURE_PDF), "-o", str(out), "--budget-usd", "0.01"],
            env=env,
        )

    assert result.exit_code == 0, result.output
    job = json.loads(out.read_text())
    assert (job["status"], job["failure"]["kind"]) == ("failed", "budget")


def test_audit_persists_the_job_when_a_database_is_given(tmp_path: Path) -> None:
    out = tmp_path / "findings.json"
    db_file = tmp_path / "argus.db"
    with _fake_providers() as env:
        result = CliRunner().invoke(
            app,
            [
                "audit",
                str(FIXTURE_PDF),
                "-o",
                str(out),
                "--db-url",
                f"sqlite+aiosqlite:///{db_file}",
            ],
            env=env,
        )

    assert result.exit_code == 0, result.output
    stored = sqlite3.connect(db_file).execute("select id from jobs").fetchall()
    assert stored == [(json.loads(out.read_text())["id"],)]
