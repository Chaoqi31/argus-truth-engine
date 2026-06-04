"""Phase A node: run planner agent to extract claims from a ParsedDoc."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.base import JsonRepairFailed
from argus.agents.planner import run_planner
from argus.engineering import BudgetExceeded
from argus.log import log
from argus.orchestrator.assemblers import _build_trace, _step_payload
from argus.orchestrator.context import _charge_result, _Ctx, _State


def _planner_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        doc = state.get("doc")
        if doc is None:
            return {"aborted": True, "abort_reason": "no parsed document"}
        input_mode = state.get("input_mode", "pdf")
        try:
            result = await run_planner(
                doc,
                cheap_client=ctx.cheap_client,
                miromind_client=ctx.client,
                input_mode=input_mode,
            )
        except JsonRepairFailed as exc:
            log.error("orchestrator.planner_failed", error=str(exc)[:500])
            return {"aborted": True, "abort_reason": f"planner: {exc}"}

        try:
            _charge_result(ctx, result)
        except BudgetExceeded as exc:
            log.error("orchestrator.budget_exceeded_at_planner", error=str(exc))
            return {"aborted": True, "abort_reason": str(exc)}

        claims = result.parsed.to_claims()
        trace = _build_trace(
            job_id=ctx.job_id, claim_id="(planner)", agent="planner", stream=result.final
        )
        await ctx.publisher.publish("step", _step_payload(trace, n_claims=len(claims)))
        return {
            "claims": claims,
            "traces": {trace.id: trace},
            "stage_summaries": {"planner": {"n_claims": len(claims)}},
        }
    return node
