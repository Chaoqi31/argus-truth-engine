"""Pipeline orchestration — graph compilation, phase execution, finalization."""
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from langgraph.graph import END, START, StateGraph

if TYPE_CHECKING:
    from argus.db.repository import JobRepository

from argus.config import Settings
from argus.engineering import BoundedRunner, BudgetExceeded, BudgetTracker
from argus.llm.cheap_client import CheapLLMClient
from argus.log import log
from argus.miromind.client import MiromindClient
from argus.models.domain import Job
from argus.orchestrator.context import (
    _Ctx,
    _Publisher,
    _State,
)
from argus.orchestrator.nodes.parse import _parse_node
from argus.orchestrator.nodes.planner import _planner_node
from argus.orchestrator.nodes.atomizer import _atomizer_node
from argus.orchestrator.nodes.checkworthiness import _checkworthiness_node
from argus.orchestrator.nodes.unified_verifier import _unified_verifier_node
from argus.orchestrator.nodes.consistency import _consistency_node
from argus.orchestrator.nodes.confidence import _confidence_node
from argus.orchestrator.nodes.reporter import _reporter_node
from argus.trace_bus.base import TraceBus


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
    auto_review: bool = False,
    checkpointer: Any = None,
) -> Job:
    job_id = job.id
    budget = BudgetTracker(max_usd=budget_usd)
    runners = {
        "unified_verifier": BoundedRunner(
            max_concurrent=settings.unified_verifier_concurrency,
        ),
        "consistency": BoundedRunner(
            max_concurrent=settings.consistency_concurrency,
        ),
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

    cache = None
    if settings.cache_enabled and repo is not None:
        from argus.cache.finding_cache import FindingCache
        cache = FindingCache(
            repo.sessionmaker,
            default_ttl_days=settings.cache_ttl_days,
            time_sensitive_ttl_days=settings.cache_ttl_time_sensitive_days,
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
        cache=cache,
    )

    await publisher.publish("started", {"input_mode": job.input_mode})

    config = {"configurable": {"thread_id": job_id}}

    # ── Phase A: parse → planner → atomizer → checkworthiness → review_gate ──
    phase_a = _build_phase_a(ctx, checkpointer=checkpointer, auto_review=auto_review)

    final_state: _State = {}
    raised_exc: Exception | None = None
    try:
        final_state = await phase_a.ainvoke(initial, config)
    except Exception as exc:
        raised_exc = exc
        log.error("orchestrator.phase_a_raised", job_id=job_id,
                  error_type=type(exc).__name__, error=str(exc)[:300])

    if raised_exc or final_state.get("aborted"):
        return await _finalize(job, final_state, budget, publisher, output_path,
                               repo, raised_exc, cheap_client)

    await publisher.publish("resumed", {})

    # ── Phase B: specialists → reporter ──
    phase_b = _build_phase_b(ctx, checkpointer=checkpointer)

    try:
        final_state = await phase_b.ainvoke(final_state, config)
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


def _build_phase_a(ctx: _Ctx, checkpointer: Any = None, *, auto_review: bool = False) -> Any:
    """Phase A: parse → planner → atomizer → checkworthiness → review_gate."""
    from argus.orchestrator.nodes.review_gate import _review_gate_node
    graph: Any = StateGraph(_State)
    graph.add_node("parse_pdf", _parse_node(ctx))
    graph.add_node("planner", _planner_node(ctx))
    graph.add_node("atomizer", _atomizer_node(ctx))
    graph.add_node("checkworthiness", _checkworthiness_node(ctx))
    graph.add_node("review_gate", _review_gate_node(ctx, auto_review=auto_review))

    graph.add_edge(START, "parse_pdf")
    graph.add_edge("parse_pdf", "planner")
    graph.add_edge("planner", "atomizer")
    graph.add_edge("atomizer", "checkworthiness")
    graph.add_edge("checkworthiness", "review_gate")
    graph.add_edge("review_gate", END)
    return graph.compile(checkpointer=checkpointer)


def _build_phase_b(ctx: _Ctx, checkpointer: Any = None) -> Any:
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
    return graph.compile(checkpointer=checkpointer)
