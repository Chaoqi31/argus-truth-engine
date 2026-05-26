"""Argus orchestrator — LangGraph parallel pipeline.

Flow (LangGraph StateGraph):

  Phase A: parse_pdf → planner → atomizer → checkworthiness
  Phase B: unified_verifier  ---+
           consistency       --->  confidence → reporter → END

The UnifiedVerifier processes ALL claims (no claim-type filtering) and
lets MiroMind decide the verification strategy. Domain hints are injected
based on claim type and content domain.

Engineering controls:
  * BoundedRunner per agent caps in-flight per-claim concurrency.
  * BudgetTracker charges after every ResponseCompletedEvent;
    BudgetExceeded aborts further work, Reporter still tries to summarise
    whatever made it through.
  * Idempotency keys travel in MiroMind request metadata for B3's
    event-store dedup.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from langgraph.graph import END, START, StateGraph

if TYPE_CHECKING:
    from argus.db.repository import JobRepository

from argus.agents.base import AgentResult, JsonRepairFailed
from argus.config import Settings
from argus.engineering import (
    BoundedRunner,
    BudgetExceeded,
    BudgetTracker,
    make_idempotency_key,
)
from argus.hitl import ReviewGate
from argus.llm.cheap_client import CheapLLMClient
from argus.log import log
from argus.miromind.client import MiromindClient
from argus.models.domain import (
    Claim,
    Evidence,
    Finding,
    FindingVerdict,
    Job,
    ReasoningTrace,
    Severity,
)
from argus.trace_bus.base import TraceBus
from argus.orchestrator.context import (
    _MAX_CONCURRENT_PER_AGENT,
    _State,
    _Ctx,
    _Publisher,
    _charge_result,
)
from argus.orchestrator.assemblers import (
    _make_finding,
    _surrounding_text,
    _build_trace,
    _step_payload,
    _finding_payload,
)
from argus.orchestrator.nodes.parse import _parse_node
from argus.orchestrator.nodes.planner import _planner_node
from argus.orchestrator.nodes.atomizer import _atomizer_node
from argus.orchestrator.nodes.checkworthiness import _checkworthiness_node
from argus.orchestrator.nodes.unified_verifier import _unified_verifier_node
from argus.orchestrator.nodes.consistency import _consistency_node
from argus.orchestrator.nodes.confidence import _confidence_node
from argus.orchestrator.nodes.reporter import _reporter_node
from argus.orchestrator.pipeline import (
    _build_phase_a,
    _build_phase_b,
    _run_pipeline,
    _finalize,
)


# --- Public entry point ----------------------------------------------------


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
    review_gate: ReviewGate | None = None,
    auto_review: bool = False,
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
    job = Job(id=job_id, pdf_path=str(pdf_path), input_mode="pdf",
              auto_review=auto_review, status="parsing")

    initial: _State = {
        "job_id": job_id,
        "pdf_path": pdf_path,
        "text": None,
        "input_mode": "pdf",
        "doc": None,
        "claims": [],
        "original_claims": [],
        "filtered_claims": [],
        "findings": [],
        "traces": {},
        "evidences": [],
        "audit_report_md": None,
        "aborted": False,
        "abort_reason": "",
    }

    return await _run_pipeline(
        job=job,
        initial=initial,
        output_path=Path(output_path),
        settings=settings,
        client=client,
        budget_usd=budget_usd,
        repo=repo,
        trace_bus=trace_bus,
        review_gate=review_gate,
        auto_review=auto_review,
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
    review_gate: ReviewGate | None = None,
    auto_review: bool = False,
    content_domain: str = "general",
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
        "findings": [],
        "traces": {},
        "evidences": [],
        "audit_report_md": None,
        "aborted": False,
        "abort_reason": "",
    }

    return await _run_pipeline(
        job=job,
        initial=initial,
        output_path=output_path,
        settings=settings,
        client=client,
        budget_usd=budget_usd,
        repo=repo,
        trace_bus=trace_bus,
        review_gate=review_gate,
        auto_review=auto_review,
    )


# --- Node factories --------------------------------------------------------












# --- Per-claim specialist helper ------------------------------------------


async def _per_claim_specialist(
    *,
    ctx: _Ctx,
    state: _State,
    claim_filter: Callable[[Claim], bool],
    agent_name: str,
    metadata_agent: str,
    severity_map: dict[FindingVerdict, Severity],
    run_call: Callable[[Claim, str, list[dict[str, str]] | None], Awaitable[AgentResult[Any]]],
    uses_surrounding: bool,
    search_strategies: dict[str, list[Any]] | None = None,
) -> dict[str, Any]:
    matched = [c for c in state.get("claims", []) if claim_filter(c)]
    if not matched:
        return {}

    doc = state.get("doc")
    runner = ctx.runners[metadata_agent]

    async def run_for_claim(
        claim: Claim,
    ) -> tuple[Claim, AgentResult[Any] | None, Exception | None]:
        async with runner.acquire():
            surrounding = (
                _surrounding_text(doc, claim) if (uses_surrounding and doc) else ""
            )
            # Idempotency key travels in the model client's submit metadata.
            # AgentRunner only forwards `{"agent": ...}` today; the key
            # surfaces in logs and is forwarded to MiroMind via
            # `metadata={"idempotency_key": ...}` once AgentRunner is taught
            # about it (B3). For now we generate it for observability.
            _ = make_idempotency_key(ctx.job_id, agent_name, claim.id)
            # Pass pre-planned search strategies for this claim
            claim_strats: list[dict[str, str]] | None = None
            if search_strategies and claim.id in search_strategies:
                claim_strats = [
                    {"angle": s.angle, "query": s.query, "rationale": s.rationale}
                    if hasattr(s, "angle") else s
                    for s in search_strategies[claim.id]
                ]
            try:
                return claim, await run_call(claim, surrounding, claim_strats), None
            except JsonRepairFailed as exc:
                log.warning(
                    "orchestrator.specialist_failed",
                    agent=agent_name,
                    claim_id=claim.id,
                    error=str(exc)[:300],
                )
                return claim, None, exc
            except (asyncio.CancelledError, BudgetExceeded):
                # Cancellation and budget-exhaustion are intentional aborts —
                # propagate so the orchestrator can finalize correctly.
                raise
            except Exception as exc:
                # Any other failure (RemoteProtocolError mid-stream, transient
                # MiroMind 5xx after retries, unexpected agent crashes…) must
                # NOT poison sibling agents. Log and treat this claim as
                # un-audited; the surviving findings still ship.
                log.warning(
                    "orchestrator.specialist_failed",
                    agent=agent_name,
                    claim_id=claim.id,
                    error_type=type(exc).__name__,
                    error=str(exc)[:300],
                )
                return claim, None, exc

    results = await asyncio.gather(*(run_for_claim(c) for c in matched))

    new_findings: list[Finding] = []
    new_traces: dict[str, ReasoningTrace] = {}
    new_evidences: list[Evidence] = []

    for claim, agent_result, failure in results:
        if failure is not None or agent_result is None:
            continue
        try:
            _charge_result(ctx, agent_result)
        except BudgetExceeded as exc:
            log.warning(
                "orchestrator.budget_exceeded_at_specialist",
                agent=agent_name,
                error=str(exc),
            )
            return {
                "aborted": True,
                "abort_reason": str(exc),
                "findings": new_findings,
                "traces": new_traces,
                "evidences": new_evidences,
            }
        trace = _build_trace(
            job_id=ctx.job_id, claim_id=claim.id, agent=agent_name, stream=agent_result.final
        )
        new_traces[trace.id] = trace
        finding, ev_records = _make_finding(
            job_id=ctx.job_id,
            claim=claim,
            parsed=agent_result.parsed,
            trace=trace,
            agent_name=agent_name,
            severity_map=severity_map,
        )
        new_findings.append(finding)
        new_evidences.extend(ev_records)
        await ctx.publisher.publish("step", _step_payload(trace))
        await ctx.publisher.publish("finding", _finding_payload(finding))

    return {
        "findings": new_findings,
        "traces": new_traces,
        "evidences": new_evidences,
    }




