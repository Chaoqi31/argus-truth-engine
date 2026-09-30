"""Public orchestrator entry points — audit a PDF or raw text end-to-end."""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from argus.config import Settings
from argus.llm import Llm
from argus.models.domain import ContentDomain, Job
from argus.orchestrator.context import _State
from argus.orchestrator.pipeline import resume_audit, run_audit
from argus.trace_bus.base import TraceBus

if TYPE_CHECKING:
    from argus.db.repository import JobRepository


def _domain(content_domain: str) -> ContentDomain:
    is_known = content_domain in ContentDomain.__members__.values()
    return ContentDomain(content_domain) if is_known else ContentDomain.GENERAL


def _initial_state(*, job_id: str, pdf_path: Path, text: str | None) -> _State:
    return {
        "job_id": job_id,
        "pdf_path": pdf_path,
        "text": text,
        "input_mode": "text" if text is not None else "pdf",
        "doc": None,
        "claims": [],
        "filtered_claims": [],
        "findings": {},
        "traces": {},
        "stages": [],
        "evidences": [],
        "audit_report_md": None,
        "aborted": False,
        "abort_reason": "",
    }


async def audit_pdf(
    *,
    pdf_path: Path | str,
    output_path: Path | str,
    settings: Settings,
    llm: Llm,
    budget_usd: float = 5.0,
    repo: JobRepository | None = None,
    trace_bus: TraceBus | None = None,
    job_id: str | None = None,
    auto_review: bool = False,
    content_domain: str = "general",
) -> Job:
    """Audit a PDF.

    Pass ``job_id`` to override the auto-generated id. The HTTP API uses this
    so the submit-time id (returned by POST /jobs) equals the id under which
    trace events are published.
    """
    pdf_path = Path(pdf_path)
    job_id = job_id or f"job_{uuid4().hex[:12]}"
    job = Job(id=job_id, pdf_path=str(pdf_path), input_mode="pdf",
              content_domain=_domain(content_domain), auto_review=auto_review,
              status="parsing")
    return await run_audit(
        job=job,
        initial=_initial_state(job_id=job_id, pdf_path=pdf_path, text=None),
        output_path=Path(output_path),
        settings=settings,
        llm=llm,
        budget_usd=budget_usd,
        repo=repo,
        trace_bus=trace_bus,
        auto_review=auto_review,
    )


async def audit_text(
    *,
    text: str,
    output_path: Path | str,
    settings: Settings,
    llm: Llm,
    budget_usd: float = 5.0,
    repo: JobRepository | None = None,
    trace_bus: TraceBus | None = None,
    job_id: str | None = None,
    auto_review: bool = False,
    content_domain: str = "general",
) -> Job:
    """Audit LLM-generated text for hallucinations and errors."""
    job_id = job_id or f"job_{uuid4().hex[:12]}"
    job = Job(
        id=job_id, input_text=text, input_mode="text",
        content_domain=_domain(content_domain), auto_review=auto_review,
        status="parsing",
    )
    return await run_audit(
        job=job,
        initial=_initial_state(job_id=job_id, pdf_path=Path("."), text=text),
        output_path=Path(output_path),
        settings=settings,
        llm=llm,
        budget_usd=budget_usd,
        repo=repo,
        trace_bus=trace_bus,
        auto_review=auto_review,
    )


async def audit_resume(
    *,
    job_id: str,
    selected_claim_ids: list[str],
    settings: Settings,
    llm: Llm,
    budget_usd: float,
    repo: JobRepository,
    trace_bus: TraceBus | None,
    output_path: Path,
) -> Job:
    """Resume a job paused at the review gate with the claims the reviewer kept."""
    job = await repo.get_job(job_id)
    if job is None:
        raise RuntimeError(f"job {job_id} not found")
    return await resume_audit(
        job=job,
        selected_claim_ids=selected_claim_ids,
        output_path=output_path,
        settings=settings,
        llm=llm,
        budget_usd=budget_usd,
        repo=repo,
        trace_bus=trace_bus,
    )
