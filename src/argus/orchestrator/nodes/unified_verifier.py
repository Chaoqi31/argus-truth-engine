"""Phase B node: run UnifiedVerifier on all claims in parallel."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from argus.agents.base import AgentResult, JsonRepairFailed
from argus.agents.domain_hints import get_domain_hint
from argus.agents.unified_verifier import VERIFIER_VERSION, verify_claim
from argus.cache.key import claim_cache_key
from argus.engineering import BudgetExceeded, make_idempotency_key
from argus.log import log
from argus.models.domain import Claim, ClaimType, Evidence, Finding, FindingVerdict, ReasoningTrace
from argus.orchestrator.assemblers import (
    _build_trace,
    _finding_payload,
    _make_unified_finding,
    _step_payload,
    _surrounding_text,
)
from argus.orchestrator.context import _charge_result, _Ctx, _State


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
        ) -> tuple[Claim, AgentResult[Any] | None, Exception | None, Finding | None]:
            async with runner.acquire():
                surrounding = _surrounding_text(doc, claim) if doc else ""
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
                        # TODO: also re-emit cached evidences with rebound IDs into
                        # this job's evidence list. Today cached findings keep their
                        # original evidence_ids which point to the cached job's rows
                        # — fine for verdict display, but means evidence detail
                        # cards won't render on cache hits. Tracked as follow-up.
                        cached_template, _cached_evs = hit
                        # Re-bind to current job + claim (cached payload was from a different job)
                        rebound = cached_template.model_copy(update={
                            "id": f"fnd_{uuid4().hex[:12]}",
                            "job_id": ctx.job_id,
                            "claim_id": claim.id,
                            "from_cache": True,
                        })
                        return claim, None, None, rebound

                _ = make_idempotency_key(ctx.job_id, "UnifiedVerifier", claim.id)
                try:
                    result = await verify_claim(
                        ctx.client, claim.text,
                        surrounding=surrounding,
                        domain_hint=domain_hint,
                    )
                    return claim, result, None, None
                except JsonRepairFailed as exc:
                    log.warning(
                        "orchestrator.specialist_failed",
                        agent="UnifiedVerifier",
                        claim_id=claim.id,
                        error=str(exc)[:300],
                    )
                    return claim, None, exc, None
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
                    return claim, None, exc, None

        results = await asyncio.gather(*(run_for_claim(c) for c in claims))

        new_findings: list[Finding] = []
        new_traces: dict[str, ReasoningTrace] = {}
        new_evidences: list[Evidence] = []

        for claim, agent_result, failure, cached_finding in results:
            if cached_finding is not None:
                # Cache hit path — no MiroMind cost, no fresh trace
                new_findings.append(cached_finding)
                await ctx.publisher.publish("finding", _finding_payload(cached_finding))
                continue

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

        return {
            "findings": new_findings,
            "traces": new_traces,
            "evidences": new_evidences,
        }
    return node
