"""Phase B node: run UnifiedVerifier on all claims in parallel."""
from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.domain_hints import get_domain_hint
from argus.agents.unified_verifier import (
    VERIFIER_VERSION,
    VERIFY,
    UnifiedVerifierOutput,
    build_verifier_input,
)
from argus.cache.finding_cache import CachedVerdict
from argus.cache.key import claim_cache_key
from argus.engineering import BudgetExceeded, make_idempotency_key
from argus.llm import Answer, Failed, FailureReason
from argus.log import log
from argus.models.domain import (
    Agent,
    Claim,
    ClaimType,
    Evidence,
    Failure,
    FailureKind,
    Finding,
    FindingFlag,
    FindingVerdict,
    ReasoningTrace,
    Stage,
    Step,
    Usage,
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
_FAILED: dict[FailureReason, tuple[str, FindingFlag]] = {
    "timeout": (
        "Verification timed out before MiroMind returned a complete result.",
        FindingFlag.VERIFIER_TIMED_OUT,
    ),
    "unparseable": (
        "Verification could not be completed — the verifier's response could "
        "not be parsed into a valid result.",
        FindingFlag.VERIFIER_UNPARSEABLE,
    ),
    "request_error": (
        "Verification could not be completed — the request to MiroMind failed.",
        FindingFlag.VERIFIER_REQUEST_FAILED,
    ),
}


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
        ) -> tuple[Claim, Answer[UnifiedVerifierOutput] | CachedVerdict]:
            async with runner.acquire():
                await ctx.publisher.claim(
                    status="started",
                    claim=claim,
                    agent=Agent.VERIFIER,
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
                        return claim, hit.for_claim(claim.id)

                idem_key = make_idempotency_key(
                    ctx.job_id, Agent.VERIFIER, claim.id
                )

                async def publish_live_step(step: Step) -> None:
                    await ctx.publisher.publish(
                        "step",
                        _live_step_payload(
                            agent=Agent.VERIFIER,
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
                            agent=Agent.VERIFIER,
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
            if isinstance(answer, CachedVerdict):
                cached_finding = answer.finding
                new_findings.append(cached_finding)
                new_evidences.extend(answer.evidences)
                new_traces[answer.trace.id] = answer.trace
                await ctx.publisher.publish("step", _step_payload(answer.trace))
                await ctx.publisher.publish("finding", _finding_payload(cached_finding))
                await ctx.publisher.claim(
                    status="finished",
                    claim=claim,
                    agent=Agent.VERIFIER,
                    index=index,
                    total=len(claims),
                    verdict=cached_finding.verdict.value,
                    severity=cached_finding.severity.value,
                )
                continue

            if isinstance(answer, Failed):
                log.warning(
                    "orchestrator.specialist_failed",
                    agent=Agent.VERIFIER,
                    claim_id=claim.id,
                    reason=answer.reason,
                    error=answer.detail[:300],
                )
                trace = _build_trace(
                    claim_id=claim.id,
                    agent=Agent.VERIFIER, engine=answer.engine, usage=Usage(), steps=(),
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
                    agent=Agent.VERIFIER,
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
                    agent=Agent.VERIFIER,
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
                    agent=Agent.VERIFIER,
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
                agent=Agent.VERIFIER, engine=answer.engine,
                usage=answer.usage, steps=answer.steps,
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
                agent=Agent.VERIFIER,
                index=index,
                total=len(claims),
                verdict=finding.verdict.value,
                severity=finding.severity.value,
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


async def remember_verdicts(ctx: _Ctx, state: _State) -> None:
    """Cache each verdict this job paid for, as the skeptic left it, with its
    evidence and trace. Uncertain verdicts are often transient, so a later job
    verifies those again."""
    if ctx.cache is None:
        return
    claims = {c.id: c for c in state.get("claims", [])}
    evidences = {e.id: e for e in state.get("evidences", [])}
    traces = state.get("traces", {})
    for finding in state.get("findings", {}).values():
        if (
            finding.agent != Agent.VERIFIER
            or finding.from_cache
            or finding.verdict == FindingVerdict.UNCERTAIN
        ):
            continue
        claim = claims[finding.claim_id]
        await ctx.cache.put(
            claim_cache_key(claim.text, domain=ctx.content_domain, version=VERIFIER_VERSION),
            CachedVerdict(
                finding=finding,
                evidences=tuple(evidences[i] for i in finding.evidence_ids),
                trace=traces[finding.reasoning_trace_id],
            ),
            verifier_version=VERIFIER_VERSION,
            content_domain=ctx.content_domain,
            time_sensitive=claim.type == ClaimType.TIME_SENSITIVE,
        )

