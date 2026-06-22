"""Smoke: `serve` is registered with host/port options."""
from __future__ import annotations

from click.core import Command
from typer.main import get_command
from typer.testing import CliRunner

from argus.cli import app


def test_serve_command_help_works() -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["serve", "--help"])
    assert result.exit_code == 0


def test_serve_command_exposes_host_and_port() -> None:
    click_app = get_command(app)
    serve_cmd = click_app.get_command(None, "serve")
    assert isinstance(serve_cmd, Command)
    param_names = {p.name for p in serve_cmd.params}
    assert "host" in param_names
    assert "port" in param_names
