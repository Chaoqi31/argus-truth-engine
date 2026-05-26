"""Phase B node: run UnifiedVerifier on all claims in parallel."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.base import AgentResult, JsonRepairFailed
from argus.agents.domain_hints import get_domain_hint
from argus.agents.unified_verifier import verify_claim
from argus.engineering import BudgetExceeded, make_idempotency_key
from argus.log import log
from argus.models.domain import Claim, Evidence, Finding, ReasoningTrace
from argus.orchestrator.assemblers import (
    _build_trace,
    _finding_payload,
    _make_unified_finding,
    _step_payload,
    _surrounding_text,
)
from argus.orchestrator.context import _Ctx, _State, _charge_result


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
