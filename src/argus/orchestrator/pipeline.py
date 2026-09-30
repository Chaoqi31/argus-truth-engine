"""Audit pipeline: extraction up to the review gate, then verification.

Extraction runs parse, planner, atomizer, check-worthiness and the review
gate. Verification runs the verifier and then the skeptic, while the
consistency check runs alongside both; confidence scoring and the reporter
follow. Each stage is a node that returns an update to the pipeline state
(see `_merge`). A run that needs human review stops after extraction and
persists the job; `resume_audit` picks it up from the stored job.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from argus.db.repository import JobRepository

from argus.config import Settings
from argus.engineering import BoundedRunner, BudgetTracker
from argus.llm import Llm
from argus.log import log
from argus.models.domain import Agent, Failure, FailureKind, FindingFlag, Job, Stage, StageKey
from argus.orchestrator.context import _Ctx, _Publisher, _State
from argus.orchestrator.nodes.atomizer import _atomizer_node
from argus.orchestrator.nodes.checkworthiness import _checkworthiness_node
from argus.orchestrator.nodes.confidence import _confidence_node
from argus.orchestrator.nodes.consistency import check_consistency_of, record_consistency
from argus.orchestrator.nodes.parse import _parse_node
from argus.orchestrator.nodes.planner import _planner_node
from argus.orchestrator.nodes.reporter import _reporter_node
from argus.orchestrator.nodes.review_gate import _review_gate_node
from argus.orchestrator.nodes.skeptic import _skeptic_node
from argus.orchestrator.nodes.unified_verifier import _unified_verifier_node
from argus.trace_bus.base import TraceBus


def _build_ctx(
    *,
    job: Job,
    settings: Settings,
    llm: Llm,
    budget_usd: float,
    trace_bus: TraceBus | None,
    repo: JobRepository | None,
) -> _Ctx:
    runners = {
        "unified_verifier": BoundedRunner(
            max_concurrent=settings.unified_verifier_concurrency,
        ),
        "skeptic": BoundedRunner(
            max_concurrent=settings.skeptic_concurrency,
        ),
    }
    publisher = _Publisher(job_id=job.id, bus=trace_bus)
    # The cap covers the whole job: a resumed job carries its extraction spend.
    budget = BudgetTracker(max_usd=budget_usd, spent_usd=job.cost_usd)

    cache = None
    if settings.cache_enabled and repo is not None:
        from argus.cache.finding_cache import FindingCache
        cache = FindingCache(
            repo.sessionmaker,
            default_ttl_days=settings.cache_ttl_days,
            time_sensitive_ttl_days=settings.cache_ttl_time_sensitive_days,
        )

    return _Ctx(
        llm=llm,
        settings=settings,
        budget=budget,
        runners=runners,
        job_id=job.id,
        publisher=publisher,
        content_domain=job.content_domain.value,
        cache=cache,
    )


def _merge(state: _State, update: dict[str, Any]) -> _State:
    """Fold a stage's update into the state: findings and traces merge by id,
    evidences and stages append, every other key is replaced."""
    merged: dict[str, Any] = dict(state)
    for key, value in update.items():
        if key in ("findings", "traces"):
            merged[key] = {**merged.get(key, {}), **value}
        elif key in ("evidences", "stages"):
            merged[key] = [*merged.get(key, []), *value]
        else:
            merged[key] = value
    return cast(_State, merged)


def _ordered(stages: list[Stage]) -> list[Stage]:
    order = list(StageKey)
    return sorted(stages, key=lambda s: order.index(s.key))


async def _extract(ctx: _Ctx, state: _State, *, auto_review: bool) -> _State:
    for node in (
        _parse_node(ctx),
        _planner_node(ctx),
        _atomizer_node(ctx),
        _checkworthiness_node(ctx),
        _review_gate_node(ctx, auto_review=auto_review),
    ):
        state = _merge(state, await node(state))
    return state


async def _verify(ctx: _Ctx, state: _State) -> _State:
    async def verified_and_challenged() -> _State:
        verified = _merge(state, await _unified_verifier_node(ctx)(state))
        return _merge(verified, await _skeptic_node(ctx)(verified))

    # The consistency check reads only the claims, so its call runs alongside
    # the verifier; its findings are built after the skeptic, against the final
    # verdicts. A failure in either branch cancels the other.
    try:
        async with asyncio.TaskGroup() as group:
            challenged = group.create_task(verified_and_challenged())
            consistency = group.create_task(check_consistency_of(ctx, state.get("claims", [])))
    except ExceptionGroup as failed:
        raise failed.exceptions[0] from failed
    state = challenged.result()
    state = _merge(
        state, await record_consistency(ctx, consistency.result(), state.get("findings", {}))
    )
    # Scoring is free and applies to partial results too; a report of an
    # audit that stopped would read as complete, so it is skipped.
    state = _merge(state, await _confidence_node(ctx)(state))
    if state.get("failure"):
        return state
    return _merge(state, await _reporter_node(ctx)(state))


async def run_audit(
    *,
    job: Job,
    initial: _State,
    output_path: Path,
    settings: Settings,
    llm: Llm,
    budget_usd: float,
    repo: JobRepository | None,
    trace_bus: TraceBus | None,
    auto_review: bool,
) -> Job:
    """Run extraction, then either pause for review or verify straight away.

    The run pauses only when a reviewer can resume it: review was requested,
    there are claims to review, and a repository stores the paused job.
    """
    ctx = _build_ctx(
        job=job,
        settings=settings,
        llm=llm,
        budget_usd=budget_usd,
        trace_bus=trace_bus,
        repo=repo,
    )
    await ctx.publisher.publish("started", {"input_mode": job.input_mode})
    try:
        state = await _extract(ctx, initial, auto_review=auto_review)
    except Exception as exc:
        log.error("orchestrator.phase_a_raised", job_id=job.id,
                  error_type=type(exc).__name__, error=str(exc)[:300])
        return await _finalize(ctx, job, initial, output_path, repo, exc)
    if state.get("failure"):
        return await _finalize(ctx, job, state, output_path, repo, None)
    if not auto_review and state.get("claims") and repo is not None:
        return await _persist_awaiting_review(job, state, output_path, repo)
    await ctx.publisher.publish("resumed", {})
    return await _verify_and_finalize(ctx, job, state, output_path, repo)


async def resume_audit(
    *,
    job: Job,
    selected_claim_ids: list[str],
    output_path: Path,
    settings: Settings,
    llm: Llm,
    budget_usd: float,
    repo: JobRepository,
    trace_bus: TraceBus | None,
) -> Job:
    """Verify the claims the reviewer kept on a job paused for review."""
    ctx = _build_ctx(
        job=job,
        settings=settings,
        llm=llm,
        budget_usd=budget_usd,
        trace_bus=trace_bus,
        repo=repo,
    )
    selected = set(selected_claim_ids)
    claims = [c for c in job.claims if c.id in selected]
    await ctx.publisher.publish("review_submitted", {"n_selected": len(claims)})
    state: _State = {
        "claims": claims,
        "findings": {},
        "traces": {t.id: t for t in job.traces},
        "stages": [_with_selection(s, len(claims)) for s in job.stages],
        "evidences": [],
        "audit_report_md": None,
        "failure": None,
    }
    return await _verify_and_finalize(ctx, job, state, output_path, repo)


def _with_selection(stage: Stage, n_selected: int) -> Stage:
    """The review gate sends the reviewer's selection on, not its whole shortlist."""
    if stage.key != "review_gate":
        return stage
    return stage.model_copy(
        update={
            "summary": f"{n_selected} claim(s) sent to verification",
            "metrics": {**stage.metrics, "n_verifying": n_selected},
        }
    )


async def _verify_and_finalize(
    ctx: _Ctx,
    job: Job,
    state: _State,
    output_path: Path,
    repo: JobRepository | None,
) -> Job:
    raised_exc: Exception | None = None
    try:
        state = await _verify(ctx, state)
    except Exception as exc:
        raised_exc = exc
        log.error("orchestrator.phase_b_raised", job_id=job.id,
                  error_type=type(exc).__name__, error=str(exc)[:300])
    return await _finalize(ctx, job, state, output_path, repo, raised_exc)


async def _finalize(
    ctx: _Ctx,
    job: Job,
    final_state: _State,
    output_path: Path,
    repo: JobRepository | None,
    raised_exc: Exception | None,
) -> Job:
    """Finalize job state, persist, publish terminal event."""
    job.claims = list(final_state.get("claims", []))
    job.findings = list(final_state.get("findings", {}).values())
    job.traces = list(final_state.get("traces", {}).values())
    job.evidences = list(final_state.get("evidences", []))
    job.audit_report_md = final_state.get("audit_report_md")
    job.stages = _ordered(final_state.get("stages", []))
    if raised_exc is not None:
        job.failure = Failure(
            kind=FailureKind.ERROR,
            message=f"{type(raised_exc).__name__}: {str(raised_exc)[:200]}",
        )
    else:
        job.failure = final_state.get("failure")
    job.status = "failed" if job.failure is not None else "done"
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
        if f.agent == Agent.VERIFIER and FindingFlag.VERIFIER_TIMED_OUT in f.flags
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
    if job.failure is not None:
        terminal_payload["failure"] = job.failure.model_dump(mode="json")
    await ctx.publisher.publish(terminal_kind, terminal_payload)
    return job


async def _persist_awaiting_review(
    job: Job,
    state: _State,
    output_path: Path,
    repo: JobRepository,
) -> Job:
    """Persist a job paused for review (NOT a terminal state).

    The review gate already published "review_ready"; reconnecting clients
    replay it, so no terminal event goes out here. The stored job carries what
    verification needs: the shortlisted claims, the extraction traces and the
    extraction stages. completed_at stays None.
    """
    job.claims = list(state.get("claims", []))
    job.traces = list(state.get("traces", {}).values())
    job.stages = _ordered(state.get("stages", []))
    job.status = "awaiting_review"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(job.model_dump_json(indent=2))
    log.info("orchestrator.awaiting_review", job_id=job.id, n_claims=len(job.claims))
    try:
        await repo.save_job(job)
        log.info("orchestrator.persisted", job_id=job.id)
    except Exception as exc:
        log.error("orchestrator.persist_failed", error=str(exc)[:300])
    return job
