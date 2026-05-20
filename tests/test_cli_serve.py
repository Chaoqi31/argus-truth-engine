"""Smoke: `argus serve --help` works and `serve` is registered as a command."""
from __future__ import annotations

from typer.testing import CliRunner

from argus.cli import app


def test_serve_command_help_works() -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["serve", "--help"])
    assert result.exit_code == 0
    assert "--host" in result.output
    assert "--port" in result.output
