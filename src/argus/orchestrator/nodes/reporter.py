"""Phase B node: run reporter agent to produce the executive summary."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.base import JsonRepairFailed
from argus.agents.reporter import run_reporter
from argus.engineering import BudgetExceeded
from argus.log import log
from argus.models.domain import Stage
from argus.orchestrator.assemblers import _build_trace, _step_payload
from argus.orchestrator.context import _charge_result, _Ctx, _State


def _stage(ctx: _Ctx, summary: str) -> Stage:
    return Stage(
        key="reporter",
        name="Reporter",
        engine="deepseek" if ctx.cheap_client else "miromind",
        summary=summary,
    )


def _reporter_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        findings = list(state.get("findings", {}).values())
        await ctx.publisher.stage(
            status="started",
            key="reporter",
            name="Reporter",
            engine="deepseek" if ctx.cheap_client else "miromind",
        )
        if not findings:
            stage = await ctx.publisher.finish(_stage(ctx, "No report generated"))
            return {"stages": [stage]}
        try:
            result = await run_reporter(
                state.get("claims", []),
                findings,
                cheap_client=ctx.cheap_client,
                miromind_client=ctx.client,
            )
        except JsonRepairFailed as exc:
            log.warning("orchestrator.reporter_failed", error=str(exc)[:300])
            stage = await ctx.publisher.finish(
                _stage(ctx, "Reporter could not parse a result")
            )
            return {"stages": [stage]}

        try:
            _charge_result(ctx, result)
        except BudgetExceeded as exc:
            log.warning("orchestrator.budget_exceeded_at_reporter", error=str(exc))
            return {"aborted": True, "abort_reason": str(exc)}

        trace = _build_trace(
            job_id=ctx.job_id,
            claim_id="(reporter)",
            agent="Reporter",
            stream=result.final,
        )
        await ctx.publisher.publish("step", _step_payload(trace))
        stage = await ctx.publisher.finish(_stage(ctx, "Executive summary generated"))
        return {
            "audit_report_md": result.parsed.executive_summary_md,
            "traces": {trace.id: trace},
            "stages": [stage],
        }
    return node
