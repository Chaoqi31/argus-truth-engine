"""CLI integration test using typer's CliRunner with the orchestrator stubbed."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

from typer.testing import CliRunner

from argus.cli import app
from argus.models.domain import Job


def test_audit_command_writes_output(tmp_path: Path) -> None:
    fake_job = Job(id="job_test", pdf_path="x.pdf", status="done")

    async def _fake_audit(**kw: object) -> Job:
        out = Path(str(kw["output_path"]))
        out.write_text(fake_job.model_dump_json())
        return fake_job

    with patch("argus.cli.audit_pdf", new=_fake_audit):
        runner = CliRunner()
        out = tmp_path / "findings.json"
        # Pre-create the input PDF so Typer's `exists=True` doesn't reject it:
        fake_pdf = tmp_path / "fake.pdf"
        fake_pdf.write_bytes(b"%PDF-1.4\n%fake\n")
        # API key required by the CLI:
        result = runner.invoke(
            app,
            ["audit", str(fake_pdf), "-o", str(out)],
            env={"ARGUS_MIROMIND_API_KEY": "sk_test"},
        )
        assert result.exit_code == 0, result.output
        data = json.loads(out.read_text())
        assert data["id"] == "job_test"


def test_audit_command_passes_budget(tmp_path: Path) -> None:
    captured: dict[str, Any] = {}
    fake_job = Job(id="job_test", pdf_path="x.pdf", status="done")

    async def _fake_audit(**kw: object) -> Job:
        captured["budget_usd"] = kw["budget_usd"]
        Path(str(kw["output_path"])).write_text(fake_job.model_dump_json())
        return fake_job

    with patch("argus.cli.audit_pdf", new=_fake_audit):
        runner = CliRunner()
        out = tmp_path / "findings.json"
        fake_pdf = tmp_path / "fake.pdf"
        fake_pdf.write_bytes(b"%PDF-1.4\n%fake\n")
        result = runner.invoke(
            app,
            ["audit", str(fake_pdf), "-o", str(out), "--budget-usd", "2.5"],
            env={"ARGUS_MIROMIND_API_KEY": "sk_test"},
        )
        assert result.exit_code == 0, result.output
        assert captured["budget_usd"] == 2.5


def test_audit_command_passes_db_url(tmp_path: Path) -> None:
    captured: dict[str, Any] = {}
    fake_job = Job(id="job_test", pdf_path="x.pdf", status="done")

    async def _fake_audit(**kw: object) -> Job:
        captured["repo_present"] = kw.get("repo") is not None
        Path(str(kw["output_path"])).write_text(fake_job.model_dump_json())
        return fake_job

    with patch("argus.cli.audit_pdf", new=_fake_audit):
        runner = CliRunner()
        out = tmp_path / "findings.json"
        fake_pdf = tmp_path / "fake.pdf"
        fake_pdf.write_bytes(b"%PDF-1.4\n%fake\n")
        result = runner.invoke(
            app,
            [
                "audit",
                str(fake_pdf),
                "-o",
                str(out),
                "--db-url",
                "sqlite+aiosqlite:///:memory:",
            ],
            env={"ARGUS_MIROMIND_API_KEY": "sk_test"},
        )
        assert result.exit_code == 0, result.output
        assert captured["repo_present"] is True
