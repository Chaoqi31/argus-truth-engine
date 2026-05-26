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

from argus.agents.atomizer import run_atomizer
from argus.agents.base import AgentResult, JsonRepairFailed
from argus.agents.checkworthiness import run_checkworthiness
from argus.agents.confidence_calculator import compute_confidence_breakdown
from argus.agents.consistency import check_consistency
from argus.agents.domain_hints import get_domain_hint
from argus.agents.planner import run_planner
from argus.agents.reporter import run_reporter
from argus.agents.unified_verifier import verify_claim
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
from argus.pdf.parser import parse_pdf
from argus.trace_bus.base import TraceBus
from argus.orchestrator.context import (
    _MAX_CONCURRENT_PER_AGENT,
    _State,
    _Ctx,
    _Publisher,
    _charge_result,
    _dict_merge,
)
from argus.orchestrator.assemblers import (
    _UNIFIED_SEVERITY,
    _coerce_evidence_source,
    _make_finding,
    _make_unified_finding,
    _contradictions_to_findings,
    _surrounding_text,
    _build_trace,
    _step_payload,
    _finding_payload,
    _text_to_doc,
)
from argus.orchestrator.nodes.parse import _parse_node
from argus.orchestrator.nodes.planner import _planner_node
from argus.orchestrator.nodes.atomizer import _atomizer_node


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


async def _run_pipeline(
    *,
    job: Job,
    initial: _State,
    output_path: Path,
    settings: Settings,
    client: MiromindClient,
    budget_usd: float,
    repo: JobRepository | None,
    trace_bus: TraceBus | None,
    review_gate: ReviewGate | None = None,
    auto_review: bool = False,
) -> Job:
    job_id = job.id
    budget = BudgetTracker(max_usd=budget_usd)
    runners = {
        agent: BoundedRunner(max_concurrent=_MAX_CONCURRENT_PER_AGENT)
        for agent in (
            "unified_verifier",
            "consistency",
        )
    }
    publisher = _Publisher(job_id=job_id, bus=trace_bus)

    # Build cheap LLM client for atomizer + checkworthiness
    cheap_client: CheapLLMClient | None = None
    if settings.cheap_llm_api_key:
        cheap_client = CheapLLMClient(
            api_key=settings.cheap_llm_api_key,
            base_url=settings.cheap_llm_base_url,
            model=settings.cheap_llm_model,
            timeout_s=settings.cheap_llm_timeout_s,
        )

    ctx = _Ctx(
        client=client,
        settings=settings,
        budget=budget,
        runners=runners,
        job_id=job_id,
        publisher=publisher,
        cheap_client=cheap_client,
        content_domain=job.content_domain.value,
    )

    await publisher.publish("started", {"input_mode": job.input_mode})

    # ── Phase A: parse → planner → atomizer → checkworthiness ──
    phase_a = _build_phase_a(ctx)

    final_state: _State = {}
    raised_exc: Exception | None = None
    try:
        final_state = await phase_a.ainvoke(initial)
    except Exception as exc:
        raised_exc = exc
        log.error("orchestrator.phase_a_raised", job_id=job_id,
                  error_type=type(exc).__name__, error=str(exc)[:300])

    if raised_exc or final_state.get("aborted"):
        return await _finalize(job, final_state, budget, publisher, output_path,
                               repo, raised_exc, cheap_client)

    # ── HITL gate: wait for user to select claims ──
    claims_for_review = final_state.get("claims", [])
    filtered = final_state.get("filtered_claims", [])

    if review_gate and not auto_review and claims_for_review:
        review_gate.prepare(job_id)
        await publisher.publish("review_ready", {
            "claims": [{"id": c.id, "text": c.text, "type": c.type.value,
                         "importance": c.importance,
                         "parent_claim_id": c.parent_claim_id}
                        for c in claims_for_review],
            "filtered": filtered,
            "n_checkworthy": len(claims_for_review),
            "n_filtered": len(filtered),
        })
        log.info("orchestrator.waiting_for_review", job_id=job_id,
                 n_claims=len(claims_for_review))

        selected_ids = await review_gate.wait(job_id, timeout=300.0)
        review_gate.cleanup(job_id)

        if selected_ids is not None:
            # User selected specific claims
            selected_set = set(selected_ids)
            claims_for_review = [c for c in claims_for_review if c.id in selected_set]
            await publisher.publish("review_submitted", {
                "n_selected": len(claims_for_review),
            })
        else:
            # Timeout — proceed with all checkworthy claims
            await publisher.publish("review_submitted", {
                "n_selected": len(claims_for_review),
                "auto": True,
            })
    elif not auto_review and claims_for_review:
        # No review gate available — proceed automatically
        pass

    await publisher.publish("resumed", {})

    # Update state with possibly filtered claims
    final_state["claims"] = claims_for_review

    # ── Phase B: specialists → reporter ──
    phase_b = _build_phase_b(ctx)

    try:
        final_state = await phase_b.ainvoke(final_state)
    except Exception as exc:
        raised_exc = exc
        log.error("orchestrator.phase_b_raised", job_id=job_id,
                  error_type=type(exc).__name__, error=str(exc)[:300])

    return await _finalize(job, final_state, budget, publisher, output_path,
                           repo, raised_exc, cheap_client)


async def _finalize(
    job: Job,
    final_state: _State,
    budget: BudgetTracker,
    publisher: _Publisher,
    output_path: Path,
    repo: JobRepository | None,
    raised_exc: Exception | None,
    cheap_client: CheapLLMClient | None,
) -> Job:
    """Finalize job state, persist, publish terminal event."""
    if cheap_client:
        await cheap_client.close()

    job.claims = list(final_state.get("claims", []))
    job.findings = list(final_state.get("findings", []))
    job.traces = list(final_state.get("traces", {}).values())
    job.evidences = list(final_state.get("evidences", []))
    job.audit_report_md = final_state.get("audit_report_md")
    job.cost_usd = round(budget.spent_usd, 6)
    job.total_tokens = sum(t.total_tokens for t in job.traces)
    if raised_exc is not None:
        job.status = "failed"
        abort_reason = f"{type(raised_exc).__name__}: {str(raised_exc)[:200]}"
    else:
        job.status = "failed" if final_state.get("aborted") else "done"
        abort_reason = final_state.get("abort_reason", "")
    job.completed_at = datetime.utcnow()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(job.model_dump_json(indent=2))
    log.info(
        "orchestrator.done",
        job_id=job.id,
        status=job.status,
        n_findings=len(job.findings),
        total_tokens=job.total_tokens,
        cost_usd=job.cost_usd,
    )
    if repo is not None:
        try:
            await repo.save_job(job)
            log.info("orchestrator.persisted", job_id=job.id)
        except Exception as exc:
            log.error("orchestrator.persist_failed", error=str(exc)[:300])

    terminal_kind = "failed" if job.status == "failed" else "finished"
    terminal_payload: dict[str, Any] = {
        "status": job.status,
        "n_findings": len(job.findings),
        "cost_usd": job.cost_usd,
    }
    if job.status == "failed":
        terminal_payload["reason"] = abort_reason
    await publisher.publish(terminal_kind, terminal_payload)
    return job


# --- Graph wiring ----------------------------------------------------------


def _build_phase_a(ctx: _Ctx) -> Any:
    """Phase A: parse → planner → atomizer → checkworthiness."""
    graph: Any = StateGraph(_State)
    graph.add_node("parse_pdf", _parse_node(ctx))
    graph.add_node("planner", _planner_node(ctx))
    graph.add_node("atomizer", _atomizer_node(ctx))
    graph.add_node("checkworthiness", _checkworthiness_node(ctx))

    graph.add_edge(START, "parse_pdf")
    graph.add_edge("parse_pdf", "planner")
    graph.add_edge("planner", "atomizer")
    graph.add_edge("atomizer", "checkworthiness")
    graph.add_edge("checkworthiness", END)
    return graph.compile()


def _build_phase_b(ctx: _Ctx) -> Any:
    """Phase B: unified_verifier + consistency (parallel) → confidence → reporter."""
    graph: Any = StateGraph(_State)
    graph.add_node("unified_verifier", _unified_verifier_node(ctx))
    graph.add_node("consistency", _consistency_node(ctx))
    graph.add_node("confidence", _confidence_node(ctx))
    graph.add_node("reporter", _reporter_node(ctx))

    for n in ("unified_verifier", "consistency"):
        graph.add_edge(START, n)
        graph.add_edge(n, "confidence")
    graph.add_edge("confidence", "reporter")
    graph.add_edge("reporter", END)
    return graph.compile()


# --- Node factories --------------------------------------------------------





def _checkworthiness_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        if not claims or not ctx.cheap_client:
            return {}
        try:
            checkworthy, filtered = await run_checkworthiness(ctx.cheap_client, claims)
        except Exception as exc:
            log.warning("orchestrator.checkworthiness_failed", error=str(exc)[:300])
            return {}
        filtered_data = [
            {"claim_id": c.id, "text": c.text, "reason": reason}
            for c, reason in filtered
        ]
        log.info("orchestrator.filtered", n_checkworthy=len(checkworthy),
                 n_filtered=len(filtered))
        await ctx.publisher.publish("filtered", {
            "n_checkworthy": len(checkworthy),
            "n_filtered": len(filtered),
        })
        return {"claims": checkworthy, "filtered_claims": filtered_data}
    return node


def _unified_verifier_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        if not claims:
            return {}

        doc = state.get("doc")
        runner = ctx.runners["unified_verifier"]

        async def run_for_claim(
            claim: Claim,
        ) -> tuple[Claim, AgentResult[Any] | None, Exception | None]:
            async with runner.acquire():
                surrounding = _surrounding_text(doc, claim) if doc else ""
                domain_hint = get_domain_hint(
                    claim_type=claim.type, content_domain=ctx.content_domain,
                )
                _ = make_idempotency_key(ctx.job_id, "UnifiedVerifier", claim.id)
                try:
                    result = await verify_claim(
                        ctx.client, claim.text,
                        surrounding=surrounding,
                        domain_hint=domain_hint,
                    )
                    return claim, result, None
                except JsonRepairFailed as exc:
                    log.warning(
                        "orchestrator.specialist_failed",
                        agent="UnifiedVerifier",
                        claim_id=claim.id,
                        error=str(exc)[:300],
                    )
                    return claim, None, exc
                except (asyncio.CancelledError, BudgetExceeded):
                    raise
                except Exception as exc:
                    log.warning(
                        "orchestrator.specialist_failed",
                        agent="UnifiedVerifier",
                        claim_id=claim.id,
                        error_type=type(exc).__name__,
                        error=str(exc)[:300],
                    )
                    return claim, None, exc

        results = await asyncio.gather(*(run_for_claim(c) for c in claims))

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
                    agent="UnifiedVerifier",
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
                job_id=ctx.job_id, claim_id=claim.id,
                agent="UnifiedVerifier", stream=agent_result.final,
            )
            new_traces[trace.id] = trace
            finding, ev_records = _make_unified_finding(
                job_id=ctx.job_id,
                claim=claim,
                parsed=agent_result.parsed,
                trace=trace,
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
    return node


def _confidence_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    """Compute algorithmic confidence breakdown for each finding.

    NOTE: We mutate findings in-place rather than returning them through the
    state reducer (``Annotated[list[Finding], operator.add]``), because the
    add-reducer would *duplicate* findings instead of replacing them.  This
    is safe as long as LangGraph passes the same Python objects (true for
    in-process ``StateGraph`` without checkpointing).  If checkpointing is
    added later, switch ``findings`` to a dict-based reducer keyed by ID.
    """
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        findings = state.get("findings", [])
        if not findings:
            return {}
        all_evidences = state.get("evidences", [])
        for f in findings:
            evs = [e for e in all_evidences if e.id in f.evidence_ids]
            f.confidence_breakdown = compute_confidence_breakdown(f, evs)
        return {}
    return node



def _consistency_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        if len(claims) < 2:
            return {}
        try:
            result = await check_consistency(ctx.client, claims)
        except JsonRepairFailed as exc:
            log.warning("orchestrator.consistency_failed", error=str(exc)[:300])
            return {}

        try:
            _charge_result(ctx, result)
        except BudgetExceeded as exc:
            log.warning("orchestrator.budget_exceeded_at_consistency", error=str(exc))
            return {"aborted": True, "abort_reason": str(exc)}

        trace = _build_trace(
            job_id=ctx.job_id,
            claim_id="(consistency)",
            agent="Consistency",
            stream=result.final,
        )
        new_findings = _contradictions_to_findings(
            job_id=ctx.job_id, parsed=result.parsed, trace_id=trace.id
        )
        await ctx.publisher.publish("step", _step_payload(trace))
        for finding in new_findings:
            await ctx.publisher.publish("finding", _finding_payload(finding))
        return {"findings": new_findings, "traces": {trace.id: trace}}
    return node


def _reporter_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        findings = state.get("findings", [])
        if not findings:
            return {}
        try:
            result = await run_reporter(
                ctx.client, state.get("claims", []), findings
            )
        except JsonRepairFailed as exc:
            log.warning("orchestrator.reporter_failed", error=str(exc)[:300])
            return {}

        try:
            _charge_result(ctx, result)
        except BudgetExceeded as exc:
            log.warning("orchestrator.budget_exceeded_at_reporter", error=str(exc))
            return {"aborted": True, "abort_reason": str(exc)}

        trace = _build_trace(
            job_id=ctx.job_id,
            claim_id="(reporter)",
            agent="Reporter",
            stream=result.final,
        )
        await ctx.publisher.publish("step", _step_payload(trace))
        return {
            "audit_report_md": result.parsed.executive_summary_md,
            "traces": {trace.id: trace},
        }
    return node


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




