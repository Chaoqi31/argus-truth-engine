"""Public orchestrator entry points — audit a PDF or raw text end-to-end."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from argus.config import Settings
from argus.miromind.client import MiromindClient
from argus.models.domain import Job
from argus.orchestrator.context import _State
from argus.orchestrator.pipeline import (
    _build_ctx,
    _build_phase_a,
    _build_phase_b,
    _finalize,
    _run_pipeline,
)
from argus.trace_bus.base import TraceBus

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver

    from argus.db.repository import JobRepository


@asynccontextmanager
async def _checkpointer_cm(
    settings: Settings,
    provided: BaseCheckpointSaver[Any] | None,
) -> AsyncIterator[BaseCheckpointSaver[Any] | None]:
    """Resolve which checkpointer to use without re-entering its lifecycle.

    If the caller passed a pre-built saver (HTTP path — lifespan owns it),
    yield it as-is. Otherwise (CLI / standalone) build a fresh one for this
    call only.
    """
    if provided is not None:
        yield provided
        return
    from argus.orchestrator.checkpointer import build_checkpointer
    async with build_checkpointer(settings) as cp:
        yield cp


async def audit_pdf(
    *,
    pdf_path: Path | str,
    output_path: Path | str,
    settings: Settings,
    client: MiromindClient | None = None,
    budget_usd: float = 5.0,
    repo: JobRepository | None = None,
    trace_bus: TraceBus | None = None,
    job_id: str | None = None,
    auto_review: bool = False,
    content_domain: str = "general",
    checkpointer: BaseCheckpointSaver[Any] | None = None,
) -> Job:
    """Top-level Plan B2 pipeline — LangGraph parallel 5-agent.

    Pass ``job_id`` to override the auto-generated id. The HTTP API uses this
    so the submit-time id (returned by POST /jobs) equals the id under which
    trace events are published.
    """
    pdf_path = Path(pdf_path)
    output_path = Path(output_path)
    if client is None:
        client = MiromindClient(settings)

    if job_id is None:
        job_id = f"job_{uuid4().hex[:12]}"
    from argus.models.domain import ContentDomain
    is_known = content_domain in ContentDomain.__members__.values()
    domain = ContentDomain(content_domain) if is_known else ContentDomain.GENERAL
    job = Job(id=job_id, pdf_path=str(pdf_path), input_mode="pdf",
              content_domain=domain, auto_review=auto_review, status="parsing")

    initial: _State = {
        "job_id": job_id,
        "pdf_path": pdf_path,
        "text": None,
        "input_mode": "pdf",
        "doc": None,
        "claims": [],
        "original_claims": [],
        "filtered_claims": [],
        "findings": {},
        "traces": {},
        "evidences": [],
        "audit_report_md": None,
        "aborted": False,
        "abort_reason": "",
    }

    async with _checkpointer_cm(settings, checkpointer) as cp:
        return await _run_pipeline(
            job=job,
            initial=initial,
            output_path=Path(output_path),
            settings=settings,
            client=client,
            budget_usd=budget_usd,
            repo=repo,
            trace_bus=trace_bus,
            auto_review=auto_review,
            checkpointer=cp,
        )


async def audit_text(
    *,
    text: str,
    output_path: Path | str,
    settings: Settings,
    client: MiromindClient | None = None,
    budget_usd: float = 5.0,
    repo: JobRepository | None = None,
    trace_bus: TraceBus | None = None,
    job_id: str | None = None,
    auto_review: bool = False,
    content_domain: str = "general",
    checkpointer: BaseCheckpointSaver[Any] | None = None,
) -> Job:
    """Audit LLM-generated text for hallucinations and errors."""
    output_path = Path(output_path)
    if client is None:
        client = MiromindClient(settings)

    if job_id is None:
        job_id = f"job_{uuid4().hex[:12]}"
    from argus.models.domain import ContentDomain
    is_known = content_domain in ContentDomain.__members__.values()
    domain = ContentDomain(content_domain) if is_known else ContentDomain.GENERAL
    job = Job(
        id=job_id, input_text=text, input_mode="text",
        content_domain=domain, auto_review=auto_review, status="parsing",
    )

    initial: _State = {
        "job_id": job_id,
        "pdf_path": Path("."),
        "text": text,
        "input_mode": "text",
        "doc": None,
        "claims": [],
        "original_claims": [],
        "filtered_claims": [],
        "findings": {},
        "traces": {},
        "evidences": [],
        "audit_report_md": None,
        "aborted": False,
        "abort_reason": "",
    }

    async with _checkpointer_cm(settings, checkpointer) as cp:
        return await _run_pipeline(
            job=job,
            initial=initial,
            output_path=output_path,
            settings=settings,
            client=client,
            budget_usd=budget_usd,
            repo=repo,
            trace_bus=trace_bus,
            auto_review=auto_review,
            checkpointer=cp,
        )


async def audit_resume(
    *,
    job_id: str,
    selected_claim_ids: list[str] | None,
    settings: Settings,
    client: MiromindClient,
    budget_usd: float,
    repo: JobRepository,
    trace_bus: TraceBus | None,
    output_path: Path,
    checkpointer: BaseCheckpointSaver[Any] | None = None,
) -> Job:
    """Resume an interrupted job from its checkpointer state.

    ``selected_claim_ids``:
      * list — submitted from HITL review; passes as resume value
      * None — generic "continue from where you left off"
    """
    from langgraph.types import Command

    job = await repo.get_job(job_id)
    if job is None:
        raise RuntimeError(f"job {job_id} not found")

    async with _checkpointer_cm(settings, checkpointer) as cp:
        ctx = _build_ctx(
            job=job,
            settings=settings,
            client=client,
            budget_usd=budget_usd,
            trace_bus=trace_bus,
            repo=repo,
            is_resuming=True,
        )
        config = {"configurable": {"thread_id": job_id}}

        phase_a = _build_phase_a(ctx, checkpointer=cp, auto_review=False)

        if selected_claim_ids is not None:
            resumed_state = await phase_a.ainvoke(
                Command(resume=selected_claim_ids), config,
            )
        else:
            resumed_state = await phase_a.ainvoke(None, config)

        phase_b = _build_phase_b(ctx, checkpointer=cp)
        raised_exc: Exception | None = None
        try:
            final_state = await phase_b.ainvoke(resumed_state, config)
        except Exception as exc:
            raised_exc = exc
            final_state = resumed_state

        return await _finalize(
            job,
            final_state,
            ctx.budget,
            ctx.publisher,
            output_path,
            repo,
            raised_exc,
            ctx.cheap_client,
        )
