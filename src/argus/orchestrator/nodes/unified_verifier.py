"""Phase B node: run UnifiedVerifier on all claims in parallel."""
from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from argus.agents.domain_hints import get_domain_hint
from argus.agents.unified_verifier import (
    VERIFIER_VERSION,
    VERIFY,
    UnifiedVerifierOutput,
    build_verifier_input,
)
from argus.cache.key import claim_cache_key
from argus.engineering import BudgetExceeded, make_idempotency_key
from argus.llm import Answer, Failed, FailureReason, Usage
from argus.log import log
from argus.models.domain import (
    Claim,
    ClaimType,
    Evidence,
    Failure,
    FailureKind,
    Finding,
    FindingVerdict,
    ReasoningTrace,
    Stage,
    Step,
    new_id,
)
from argus.orchestrator.assemblers import (
    _build_trace,
    _finding_payload,
    _live_step_payload,
    _make_unified_finding,
    _step_payload,
)
from argus.orchestrator.context import _Ctx, _State

# Summary and flag of the UNCERTAIN finding that stands in for a claim the
# verifier could not finish, so the claim still surfaces in results and report.
_FAILED: dict[FailureReason, tuple[str, str]] = {
    "timeout": (
        "Verification timed out before MiroMind returned a complete result.",
        "verifier timed out",
    ),
    "unparseable": (
        "Verification could not be completed — the verifier's response could "
        "not be parsed into a valid result.",
        "unparseable verifier response",
    ),
    "request_error": (
        "Verification could not be completed — the request to MiroMind failed.",
        "verifier request failed",
    ),
}


@dataclass(frozen=True)
class _Cached:
    """A verdict reused from the finding cache, rebound to this job."""

    finding: Finding
    evidences: list[Evidence]


def _unified_verifier_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("failure"):
            return {}
        claims = state.get("claims", [])
        if not claims:
            return {}
        await ctx.publisher.stage(
            status="started",
            key="verify",
            name="Verify",
            engine="miromind",
        )

        runner = ctx.runners["unified_verifier"]

        async def run_for_claim(
            claim: Claim,
            index: int,
            total: int,
        ) -> tuple[Claim, Answer[UnifiedVerifierOutput] | _Cached]:
            async with runner.acquire():
                await ctx.publisher.claim(
                    status="started",
                    claim=claim,
                    agent="UnifiedVerifier",
                    index=index,
                    total=total,
                )
                domain_hint = get_domain_hint(
                    claim_type=claim.type, content_domain=ctx.content_domain,
                )

                # Cache lookup before the MiroMind call
                if ctx.cache is not None:
                    key = claim_cache_key(
                        claim.text, domain=ctx.content_domain, version=VERIFIER_VERSION,
                    )
                    hit = await ctx.cache.get(key)
                    if hit is not None:
                        cached_template, cached_evs = hit
                        # Rebuild evidence with fresh IDs scoped to this job, then
                        # remap the rebound finding's evidence_ids onto them — the
                        # cached IDs point at the original job's rows and would
                        # otherwise dangle (confidence calc would see 0 evidence).
                        rebuilt_evs = [
                            ev.model_copy(update={"id": new_id("ev")}) for ev in cached_evs
                        ]
                        # Re-bind to current job + claim (cached payload was from a different job)
                        rebound = cached_template.model_copy(update={
                            "id": new_id("f"),
                            "claim_id": claim.id,
                            "evidence_ids": tuple(e.id for e in rebuilt_evs),
                            "from_cache": True,
                        })
                        return claim, _Cached(rebound, rebuilt_evs)

                idem_key = make_idempotency_key(
                    ctx.job_id, "UnifiedVerifier", claim.id
                )

                async def publish_live_step(step: Step) -> None:
                    await ctx.publisher.publish(
                        "step",
                        _live_step_payload(
                            agent="UnifiedVerifier",
                            claim_id=claim.id,
                            step=step,
                        ),
                    )

                started_at = time.monotonic()

                async def publish_heartbeats() -> None:
                    interval = max(0.1, ctx.settings.trace_heartbeat_interval_s)
                    timeout = ctx.settings.miromind_response_timeout_s
                    first_delay = (
                        min(interval, max(0.01, timeout / 2))
                        if timeout and timeout > 0
                        else interval
                    )
                    await asyncio.sleep(first_delay)
                    while True:
                        await ctx.publisher.heartbeat(
                            stage="verify",
                            agent="UnifiedVerifier",
                            claim_id=claim.id,
                            elapsed_s=time.monotonic() - started_at,
                            message="MiroMind is still researching this claim.",
                        )
                        await asyncio.sleep(interval)

                heartbeat_task = asyncio.create_task(publish_heartbeats())
                try:
                    answer = await ctx.llm.ask(
                        VERIFY,
                        build_verifier_input(claim.text, claim.context, domain_hint),
                        on_step=publish_live_step,
                        idempotency_key=idem_key,
                    )
                    return claim, answer
                finally:
                    heartbeat_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await heartbeat_task

        results = await asyncio.gather(
            *(run_for_claim(c, i, len(claims)) for i, c in enumerate(claims, start=1))
        )

        new_findings: list[Finding] = []
        new_traces: dict[str, ReasoningTrace] = {}
        new_evidences: list[Evidence] = []

        for index, (claim, answer) in enumerate(results, start=1):
            if isinstance(answer, _Cached):
                # Cache hit path — no MiroMind cost, no fresh trace. The rebuilt
                # evidence is emitted into this job so evidence_ids resolve.
                cached_finding = answer.finding
                new_findings.append(cached_finding)
                new_evidences.extend(answer.evidences)
                await ctx.publisher.publish("finding", _finding_payload(cached_finding))
                await ctx.publisher.claim(
                    status="finished",
                    claim=claim,
                    agent="UnifiedVerifier",
                    index=index,
                    total=len(claims),
                    verdict=cached_finding.verdict.value,
                    severity=cached_finding.severity.value,
                )
                continue

            if isinstance(answer, Failed):
                log.warning(
                    "orchestrator.specialist_failed",
                    agent="UnifiedVerifier",
                    claim_id=claim.id,
                    reason=answer.reason,
                    error=answer.detail[:300],
                )
                trace = _build_trace(
                    claim_id=claim.id,
                    agent="UnifiedVerifier", usage=Usage(), steps=(),
                )
                summary, flag = _FAILED[answer.reason]
                # Say why it failed, briefly; the full payload stays out.
                if answer.reason == "unparseable":
                    summary += f" (parser error: {answer.detail[:120]})"
                elif answer.reason == "request_error":
                    summary += f" ({answer.detail[:120]})"
                finding = Finding(
                    id=new_id("f"),
                    claim_id=claim.id,
                    agent="UnifiedVerifier",
                    verdict=FindingVerdict.UNCERTAIN,
                    confidence=0.0,
                    summary=summary,
                    reasoning_trace_id=trace.id,
                    flags=(flag,),
                )
                new_traces[trace.id] = trace
                new_findings.append(finding)
                await ctx.publisher.publish("step", _step_payload(trace))
                await ctx.publisher.publish("finding", _finding_payload(finding))
                await ctx.publisher.claim(
                    status="finished",
                    claim=claim,
                    agent="UnifiedVerifier",
                    index=index,
                    total=len(claims),
                    verdict=finding.verdict.value,
                    severity=finding.severity.value,
                )
                continue
            try:
                ctx.budget.charge(answer.usage.cost_usd)
            except BudgetExceeded as exc:
                log.warning(
                    "orchestrator.budget_exceeded_at_specialist",
                    agent="UnifiedVerifier",
                    error=str(exc),
                )
                return {
                    "failure": Failure(kind=FailureKind.BUDGET, message=str(exc)),
                    "findings": {f.id: f for f in new_findings},
                    "traces": new_traces,
                    "evidences": new_evidences,
                }
            trace = _build_trace(
                claim_id=claim.id,
                agent="UnifiedVerifier", usage=answer.usage, steps=answer.steps,
            )
            new_traces[trace.id] = trace
            finding, ev_records = _make_unified_finding(
                claim=claim,
                parsed=answer.output,
                trace=trace,
            )
            new_findings.append(finding)
            new_evidences.extend(ev_records)
            await ctx.publisher.publish("step", _step_payload(trace))
            await ctx.publisher.publish("finding", _finding_payload(finding))
            await ctx.publisher.claim(
                status="finished",
                claim=claim,
                agent="UnifiedVerifier",
                index=index,
                total=len(claims),
                verdict=finding.verdict.value,
                severity=finding.severity.value,
            )

            # Persist to cache on fresh verification (skip UNCERTAIN — often transient)
            if ctx.cache is not None and finding.verdict != FindingVerdict.UNCERTAIN:
                key = claim_cache_key(
                    claim.text, domain=ctx.content_domain, version=VERIFIER_VERSION,
                )
                await ctx.cache.put(
                    key,
                    finding=finding,
                    evidences=ev_records,
                    verifier_version=VERIFIER_VERSION,
                    content_domain=ctx.content_domain,
                    time_sensitive=(claim.type == ClaimType.TIME_SENSITIVE),
                )

        n_steps = sum(len(t.steps) for t in new_traces.values())
        n_searches = sum(
            1 for t in new_traces.values() for step in t.steps
            if step.type.value == "web_search"
        )
        stage = await ctx.publisher.finish(
            Stage(
                key="verify",
                name="Verify",
                engine="miromind",
                summary=(
                    f"Deep-researched {len(new_findings)} claim(s) · "
                    f"{n_steps} steps · {n_searches} web searches"
                ),
                metrics={
                    "n_claims": len(new_findings),
                    "n_steps": n_steps,
                    "n_searches": n_searches,
                },
            )
        )
        return {
            "findings": {f.id: f for f in new_findings},
            "traces": new_traces,
            "evidences": new_evidences,
            "stages": [stage],
        }
    return node

