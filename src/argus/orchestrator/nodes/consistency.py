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
    _logical_flaws_to_findings,
    _step_payload,
)
from argus.orchestrator.context import _charge_result, _Ctx, _State


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
        new_findings = _contradictions_to_findings(
            job_id=ctx.job_id, parsed=result.parsed, trace_id=trace.id
        )
        new_findings += _logical_flaws_to_findings(
            job_id=ctx.job_id, parsed=result.parsed, trace_id=trace.id
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
        return {"findings": new_findings, "traces": {trace.id: trace}}
    return node
