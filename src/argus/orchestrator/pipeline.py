"""Pipeline orchestration — graph compilation, phase execution, finalization."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from langgraph.graph import END, START, StateGraph

if TYPE_CHECKING:
    from argus.db.repository import JobRepository

from argus.config import Settings
from argus.engineering import BoundedRunner, BudgetTracker
from argus.llm.cheap_client import CheapLLMClient
from argus.log import log
from argus.miromind.client import MiromindClient
from argus.models.domain import Job, Stage, StageFilteredClaim
from argus.orchestrator.context import (
    _Ctx,
    _Publisher,
    _State,
)
from argus.orchestrator.nodes.atomizer import _atomizer_node
from argus.orchestrator.nodes.checkworthiness import _checkworthiness_node
from argus.orchestrator.nodes.confidence import _confidence_node
from argus.orchestrator.nodes.consistency import _consistency_node
from argus.orchestrator.nodes.parse import _parse_node
from argus.orchestrator.nodes.planner import _planner_node
from argus.orchestrator.nodes.reporter import _reporter_node
from argus.orchestrator.nodes.skeptic import _skeptic_node
from argus.orchestrator.nodes.unified_verifier import _unified_verifier_node
from argus.trace_bus.base import TraceBus


def _build_ctx(
    *,
    job: Job,
    settings: Settings,
    client: MiromindClient,
    budget_usd: float,
    trace_bus: TraceBus | None,
    repo: JobRepository | None,
    is_resuming: bool = False,
) -> _Ctx:
    """Construct the per-pipeline _Ctx. Shared between fresh runs and resumes."""
    runners = {
        "unified_verifier": BoundedRunner(
            max_concurrent=settings.unified_verifier_concurrency,
        ),
        "skeptic": BoundedRunner(
            max_concurrent=settings.skeptic_concurrency,
        ),
        "consistency": BoundedRunner(
            max_concurrent=settings.consistency_concurrency,
        ),
    }
    publisher = _Publisher(job_id=job.id, bus=trace_bus)
    budget = BudgetTracker(max_usd=budget_usd)

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

    return _Ctx(
        client=client,
        settings=settings,
        budget=budget,
        runners=runners,
        job_id=job.id,
        publisher=publisher,
        cheap_client=cheap_client,
        content_domain=job.content_domain.value,
        cache=cache,
        is_resuming=is_resuming,
    )


def _build_skeptic_stage(job: Job) -> Stage:
    """Summarize the independent challenge pass over high-risk findings."""
    skeptic_reviews = [
        f for f in job.findings
        if f.agent == "UnifiedVerifier" and f.skeptic_review is not None
    ]
    n_reviewed = len(skeptic_reviews)
    n_counterevidence = sum(
        1 for f in skeptic_reviews
        if f.skeptic_review and f.skeptic_review.status == "counterevidence_found"
    )
    n_cleared = sum(
        1 for f in skeptic_reviews
        if f.skeptic_review and f.skeptic_review.status == "no_counterevidence"
    )
    n_inconclusive = sum(
        1 for f in skeptic_reviews
        if f.skeptic_review and f.skeptic_review.status == "inconclusive"
    )
    if n_reviewed == 0:
        summary = "No high-risk verifier findings required independent challenge"
    else:
        parts = [
            f"Challenged {n_reviewed} high-risk finding(s)",
            f"{n_counterevidence} counterevidence found",
        ]
        if n_cleared:
            parts.append(f"{n_cleared} cleared")
        if n_inconclusive:
            parts.append(f"{n_inconclusive} inconclusive")
        summary = " · ".join(parts)

    return Stage(
        key="skeptic", name="Skeptic challenge", engine="miromind",
        summary=summary,
        metrics={
            "n_reviewed": n_reviewed,
            "n_cleared": n_cleared,
            "n_counterevidence_found": n_counterevidence,
            "n_inconclusive": n_inconclusive,
        },
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
    auto_review: bool = False,
    checkpointer: Any = None,
) -> Job:
    job_id = job.id
    ctx = _build_ctx(
        job=job,
        settings=settings,
        client=client,
        budget_usd=budget_usd,
        trace_bus=trace_bus,
        repo=repo,
    )
    budget = ctx.budget
    publisher = ctx.publisher
    cheap_client = ctx.cheap_client

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

    if checkpointer is not None and "__interrupt__" in final_state:
        # The review_gate called interrupt() — graph paused for human review.
        # Persist as interrupted (NOT done) and return without running phase_b;
        # runner.resume picks it up later via Command(resume=selected_ids).
        # Only a checkpointer makes the pause resumable; without one (CLI/offline)
        # interrupt() still surfaces __interrupt__ but there's no state to resume
        # from, so we fall through to phase_b on the full claim list as before.
        return await _persist_interrupted(job, final_state, output_path, repo,
                                          cheap_client)

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


def _build_stages(final_state: _State, job: Job) -> list[Stage]:
    """Build the ordered per-stage pipeline summary for the UI.

    One Stage per pipeline node, in execution order. Reads accumulated
    per-stage counts from ``final_state["stage_summaries"]`` (populated by the
    nodes) plus the assembled Job fields. Tolerant of missing data so a partial
    run (e.g. budget abort) still yields a coherent list.
    """
    ss = final_state.get("stage_summaries", {})
    original_claims = final_state.get("original_claims", [])
    filtered = final_state.get("filtered_claims", [])
    doc = final_state.get("doc")

    stages: list[Stage] = []

    # 1. parse
    if doc is not None:
        pages = len(doc.pages)
        chars = len(doc.full_text)
    else:
        pages = 0
        chars = len(job.input_text or "")
    if job.input_mode == "text":
        parse_summary = f"Read {chars} chars of input text"
    else:
        parse_summary = f"Parsed {pages} page(s) · {chars} chars"
    stages.append(Stage(
        key="parse", name="Parse", engine="deterministic",
        summary=parse_summary, metrics={"pages": pages, "chars": chars},
    ))

    # 2. planner
    n_claims = ss.get("planner", {}).get("n_claims", len(original_claims))
    stages.append(Stage(
        key="planner", name="Planner", engine="deepseek",
        summary=f"Extracted {n_claims} candidate claim(s)",
        metrics={"n_claims": n_claims},
        strategy=ss.get("planner", {}).get("strategy"),
    ))

    # 3. atomizer
    a = ss.get("atomizer", {})
    n_original = a.get("n_original", 0)
    n_atoms = a.get("n_atoms", 0)
    if n_atoms > n_original:
        atomizer_summary = f"Split {n_original} into {n_atoms} atomic claims"
    else:
        atomizer_summary = f"Normalised {n_original} claim(s) — no splitting needed"
    stages.append(Stage(
        key="atomizer", name="Atomizer", engine="deepseek",
        summary=atomizer_summary,
        metrics={"n_original": n_original, "n_atoms": n_atoms},
    ))

    # 4. checkworthiness
    c = ss.get("checkworthiness", {})
    n_checkworthy = c.get("n_checkworthy", 0)
    n_filtered = c.get("n_filtered", 0)
    if n_filtered == 0:
        cw_summary = f"{n_checkworthy} check-worthy · none filtered"
    else:
        cw_summary = f"{n_checkworthy} check-worthy · {n_filtered} filtered out"
    stages.append(Stage(
        key="checkworthiness", name="Check-worthiness", engine="deepseek",
        summary=cw_summary,
        metrics={"n_checkworthy": n_checkworthy, "n_filtered": n_filtered},
        filtered_claims=(
            [StageFilteredClaim(**f) for f in filtered] if filtered else None
        ),
    ))

    # 5. review_gate
    r = ss.get("review_gate", {})
    n_before = r.get("n_before", 0)
    n_after = r.get("n_after", 0)
    n_verifying = r.get("n_verifying", len(job.claims))
    if n_before != n_after or n_after != n_verifying:
        rg_summary = (
            f"{n_verifying} claim(s) sent to verification "
            f"(from {n_before} after dedup/cap)"
        )
    else:
        rg_summary = f"{n_verifying} claim(s) sent to verification"
    stages.append(Stage(
        key="review_gate", name="Review gate", engine="deterministic",
        summary=rg_summary,
        metrics={
            "n_before": n_before, "n_after": n_after, "n_verifying": n_verifying,
        },
    ))

    # 6. verify
    n_steps = sum(len(t.steps) for t in job.traces)
    # Count web_search steps (consistent with the cockpit stats bar); the
    # per-trace num_search_queries aggregate isn't always populated.
    n_searches = sum(
        1 for t in job.traces for s in t.steps if s.type == "web_search"
    )
    stages.append(Stage(
        key="verify", name="Verify", engine="miromind",
        summary=(
            f"Deep-researched {job.claims_audited} claim(s) · "
            f"{n_steps} steps · {n_searches} web searches"
        ),
        metrics={
            "n_claims": job.claims_audited, "n_steps": n_steps,
            "n_searches": n_searches,
        },
    ))

    # 7. skeptic challenge
    stages.append(_build_skeptic_stage(job))

    # 8. consistency
    n_cons = sum(1 for f in job.findings if f.agent == "Consistency")
    stages.append(Stage(
        key="consistency", name="Consistency", engine="deepseek",
        summary=f"{n_cons} cross-claim issue(s) found",
        metrics={"n_findings": n_cons},
    ))

    # 9. confidence
    n_scored = sum(
        1 for f in job.findings if getattr(f, "confidence", None) is not None
    )
    stages.append(Stage(
        key="confidence", name="Confidence", engine="deterministic",
        summary=(
            f"Scored {n_scored} finding(s) on 3 factors "
            f"(authority · freshness · agreement)"
        ),
        metrics={"n_scored": n_scored},
    ))

    # 10. reporter
    stages.append(Stage(
        key="reporter", name="Reporter", engine="deepseek",
        summary=(
            "Executive summary generated" if job.audit_report_md
            else "No report generated"
        ),
        metrics={},
    ))

    return stages


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
    # Audit coverage: total claims sent to Phase B vs. how many got a verdict.
    # On a budget abort these diverge, signalling partial coverage downstream.
    job.claims_total = len(job.claims)
    job.claims_audited = sum(1 for f in job.findings if f.agent == "UnifiedVerifier")
    job.stages = _build_stages(final_state, job)
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
    timeout_findings = [
        f for f in job.findings
        if f.agent == "UnifiedVerifier" and "verifier timed out" in f.flags
    ]
    terminal_payload: dict[str, Any] = {
        "status": job.status,
        "n_findings": len(job.findings),
        "cost_usd": job.cost_usd,
        "claims_total": job.claims_total,
        "claims_audited": job.claims_audited,
        "partial_coverage": job.claims_audited < job.claims_total,
        "n_timeout_findings": len(timeout_findings),
        "timed_out_claim_ids": [f.claim_id for f in timeout_findings],
    }
    if job.status == "failed":
        terminal_payload["reason"] = abort_reason
    await publisher.publish(terminal_kind, terminal_payload)
    return job


async def _persist_interrupted(
    job: Job,
    final_state: _State,
    output_path: Path,
    repo: JobRepository | None,
    cheap_client: CheapLLMClient | None,
) -> Job:
    """Persist a job paused at the HITL review gate (NOT a terminal state).

    The gate already published "review_ready" into the bus; reconnecting
    clients replay it, so we publish no terminal event here. completed_at stays
    None — the job is not finished. runner.resume checks status == "interrupted".
    """
    if cheap_client:
        await cheap_client.close()

    job.claims = list(final_state.get("claims", []))
    job.claims_total = len(job.claims)
    job.status = "interrupted"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(job.model_dump_json(indent=2))
    log.info("orchestrator.interrupted", job_id=job.id, n_claims=len(job.claims))
    if repo is not None:
        try:
            await repo.save_job(job)
            log.info("orchestrator.persisted", job_id=job.id)
        except Exception as exc:
            log.error("orchestrator.persist_failed", error=str(exc)[:300])
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
    """Phase B: verifier → skeptic + consistency (parallel) → confidence → reporter."""
    graph: Any = StateGraph(_State)
    graph.add_node("unified_verifier", _unified_verifier_node(ctx))
    graph.add_node("skeptic", _skeptic_node(ctx))
    graph.add_node("consistency", _consistency_node(ctx))
    graph.add_node("confidence", _confidence_node(ctx))
    graph.add_node("reporter", _reporter_node(ctx))

    graph.add_edge(START, "unified_verifier")
    graph.add_edge("unified_verifier", "skeptic")
    graph.add_edge(START, "consistency")
    graph.add_edge(["skeptic", "consistency"], "confidence")
    graph.add_edge("confidence", "reporter")
    graph.add_edge("reporter", END)
    return graph.compile(checkpointer=checkpointer)
