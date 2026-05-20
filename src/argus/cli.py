"""Argus CLI."""
from __future__ import annotations

import asyncio
from pathlib import Path

import typer
from rich.console import Console

from argus.config import settings
from argus.log import configure_logging
from argus.orchestrator import audit_pdf

app = typer.Typer(
    add_completion=False,
    help="Argus — audit a research-report PDF for fabricated citations.",
)
console = Console()


@app.callback()
def _root() -> None:
    """Argus root callback (ensures `audit` stays a subcommand)."""


@app.command()
def audit(
    pdf: Path = typer.Argument(  # noqa: B008
        ..., exists=True, readable=True, help="PDF to audit."
    ),
    output: Path = typer.Option(  # noqa: B008
        Path("findings.json"), "-o", "--output", help="Output JSON path."
    ),
    log_level: str = typer.Option("INFO", "--log-level"),
) -> None:
    """Run Plan A pipeline (Planner + Citation Verifier) and write findings.json."""
    configure_logging(log_level)
    s = settings()
    if not s.miromind_api_key:
        console.print("[red]ARGUS_MIROMIND_API_KEY is not set.[/red]")
        raise typer.Exit(code=2)

    async def _go() -> None:
        job = await audit_pdf(pdf_path=pdf, output_path=output, settings=s)
        console.print(
            f"[green]✓[/green] {len(job.findings)} findings written to "
            f"[bold]{output}[/bold] "
            f"(total tokens: {job.total_tokens})"
        )

    asyncio.run(_go())
