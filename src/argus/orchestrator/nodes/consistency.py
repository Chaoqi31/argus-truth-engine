"""Phase B node: check cross-claim consistency and produce contradiction findings."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.base import JsonRepairFailed
from argus.agents.consistency import check_consistency
from argus.engineering import BudgetExceeded
from argus.log import log
from argus.models.domain import Finding, FindingVerdict
from argus.orchestrator.assemblers import (
    _build_trace,
    _contradictions_to_findings,
    _finding_payload,
    _logical_flaws_to_findings,
    _step_payload,
)
from argus.orchestrator.context import _charge_result, _Ctx, _State

_REDUNDANT_LOGICAL_VERDICTS = {
    FindingVerdict.UNSUPPORTED_INFERENCE,
    FindingVerdict.OVERREACH,
}


def _drop_redundant_logical_findings(
    existing: list[Finding],
    logical_findings: list[Finding],
) -> list[Finding]:
    covered_claim_ids = {
        f.claim_id
        for f in existing
        if f.agent == "UnifiedVerifier"
        and f.verdict not in {FindingVerdict.OK, FindingVerdict.UNCERTAIN}
    }
    return [
        f
        for f in logical_findings
        if not (
            f.agent == "Consistency"
            and f.verdict in _REDUNDANT_LOGICAL_VERDICTS
            and f.claim_id in covered_claim_ids
            and not f.evidence_ids
        )
    ]


def _consistency_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        await ctx.publisher.stage(
            status="started",
            key="consistency",
            name="Consistency",
            engine="deepseek" if ctx.cheap_client else "miromind",
        )
        if len(claims) < 2:
            await ctx.publisher.stage(
                status="finished",
                key="consistency",
                name="Consistency",
                engine="deepseek" if ctx.cheap_client else "miromind",
                summary="Skipped consistency check — fewer than 2 claims",
                metrics={"n_findings": 0},
            )
            return {}
        try:
            result = await check_consistency(
                claims, cheap_client=ctx.cheap_client, miromind_client=ctx.client
            )
        except JsonRepairFailed as exc:
            log.warning("orchestrator.consistency_failed", error=str(exc)[:300])
            await ctx.publisher.stage(
                status="finished",
                key="consistency",
                name="Consistency",
                engine="deepseek" if ctx.cheap_client else "miromind",
                summary="Consistency check could not parse a result",
                metrics={"n_findings": 0},
            )
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
        existing_findings = list(state.get("findings", {}).values())
        new_findings = _contradictions_to_findings(
            job_id=ctx.job_id, parsed=result.parsed, trace_id=trace.id
        )
        logical_findings = _logical_flaws_to_findings(
            job_id=ctx.job_id, parsed=result.parsed, trace_id=trace.id
        )
        new_findings += _drop_redundant_logical_findings(
            existing_findings, logical_findings
        )
        await ctx.publisher.publish("step", _step_payload(trace))
        for finding in new_findings:
            await ctx.publisher.publish("finding", _finding_payload(finding))
        await ctx.publisher.stage(
            status="finished",
            key="consistency",
            name="Consistency",
            engine="deepseek" if ctx.cheap_client else "miromind",
            summary=f"{len(new_findings)} cross-claim issue(s) found",
            metrics={"n_findings": len(new_findings)},
        )
        return {
            "findings": {f.id: f for f in new_findings},
            "traces": {trace.id: trace},
        }
    return node
