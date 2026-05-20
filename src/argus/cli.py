"""Argus CLI."""
from __future__ import annotations

import asyncio
from pathlib import Path

import typer
from rich.console import Console

from argus.config import settings
from argus.db.repository import JobRepository
from argus.db.session import create_engine_from_url, sessionmaker_from_engine
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
    budget_usd: float = typer.Option(
        5.0,
        "--budget-usd",
        help="Hard cap on per-job MiroMind spend in USD. Default 5.",
        min=0.01,
    ),
    db_url: str | None = typer.Option(
        None,
        "--db-url",
        envvar="ARGUS_DB_URL",
        help=(
            "Optional async SQLAlchemy URL. When set, the completed Job is "
            "persisted to the database in addition to findings.json. "
            "Example: postgresql+asyncpg://argus:argus@localhost:5436/argus"
        ),
    ),
) -> None:
    """Run the 5-agent audit pipeline and write findings.json."""
    configure_logging(log_level)
    s = settings()
    if not s.miromind_api_key:
        console.print("[red]ARGUS_MIROMIND_API_KEY is not set.[/red]")
        raise typer.Exit(code=2)

    repo = None
    if db_url:
        engine = create_engine_from_url(db_url)
        repo = JobRepository(sessionmaker_from_engine(engine))

    async def _go() -> None:
        job = await audit_pdf(
            pdf_path=pdf,
            output_path=output,
            settings=s,
            budget_usd=budget_usd,
            repo=repo,
        )
        console.print(
            f"[green]✓[/green] {len(job.findings)} findings written to "
            f"[bold]{output}[/bold] "
            f"(total tokens: {job.total_tokens}, spend: ${job.cost_usd:.2f})"
        )
        if repo is not None:
            console.print(
                f"  also persisted to [bold]{db_url}[/bold] as job "
                f"[bold]{job.id}[/bold]"
            )

    asyncio.run(_go())


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8080, "--port"),
    log_level: str = typer.Option("INFO", "--log-level"),
) -> None:
    """Start the Argus HTTP + WebSocket API server."""
    configure_logging(log_level)
    s = settings()
    if not s.miromind_api_key:
        console.print("[red]ARGUS_MIROMIND_API_KEY is not set.[/red]")
        raise typer.Exit(code=2)

    # Lazy import so the CLI doesn't require uvicorn until `serve` runs.
    import uvicorn  # noqa: PLC0415

    from argus.api.app import create_app  # noqa: PLC0415

    app_instance = create_app(settings=s)
    console.print(
        f"[green]✓[/green] Argus API at [bold]http://{host}:{port}[/bold]"
    )
    uvicorn.run(app_instance, host=host, port=port, log_level=log_level.lower())
