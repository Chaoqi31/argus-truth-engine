"""Phase B node: check cross-claim consistency and produce contradiction findings."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.base import JsonRepairFailed
from argus.agents.consistency import check_consistency
from argus.engineering import BudgetExceeded
from argus.log import log
from argus.orchestrator.assemblers import (
    _build_trace,
    _contradictions_to_findings,
    _finding_payload,
    _step_payload,
)
from argus.orchestrator.context import _charge_result, _Ctx, _State


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
