"""Smoke: `argus serve --help` works and `serve` is registered as a command."""
from __future__ import annotations

from typer.testing import CliRunner

from argus.cli import app


def test_serve_command_help_works() -> None:
    runner = CliRunner()
    # GitHub Actions uses a narrow pseudo-TTY; Rich help panels omit flags without width.
    result = runner.invoke(
        app,
        ["serve", "--help"],
        env={"COLUMNS": "200", "LINES": "50"},
    )
    assert result.exit_code == 0
    assert "--host" in result.output
    assert "--port" in result.output
