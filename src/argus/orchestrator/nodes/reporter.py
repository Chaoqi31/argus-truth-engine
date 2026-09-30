"""Phase B node: run reporter agent to produce the executive summary."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.reporter import REPORT, build_reporter_input
from argus.engineering import BudgetExceeded
from argus.llm import Failed, FailureReason
from argus.log import log
from argus.models.domain import Stage
from argus.orchestrator.assemblers import _build_trace, _step_payload
from argus.orchestrator.context import _Ctx, _State

_FAILED: dict[FailureReason, str] = {
    "timeout": "Reporter timed out",
    "unparseable": "Reporter could not parse a result",
    "request_error": "Reporter request failed",
}


def _stage(ctx: _Ctx, summary: str) -> Stage:
    return Stage(
        key="reporter",
        name="Reporter",
        engine=ctx.llm.engine(REPORT),
        summary=summary,
    )


def _reporter_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        findings = list(state.get("findings", {}).values())
        await ctx.publisher.stage(
            status="started",
            key="reporter",
            name="Reporter",
            engine=ctx.llm.engine(REPORT),
        )
        if not findings:
            stage = await ctx.publisher.finish(_stage(ctx, "No report generated"))
            return {"stages": [stage]}
        answer = await ctx.llm.ask(
            REPORT, build_reporter_input(state.get("claims", []), findings)
        )
        if isinstance(answer, Failed):
            log.warning(
                "orchestrator.reporter_failed", reason=answer.reason, error=answer.detail[:300]
            )
            stage = await ctx.publisher.finish(_stage(ctx, _FAILED[answer.reason]))
            return {"stages": [stage]}

        try:
            ctx.budget.charge(answer.usage.cost_usd)
        except BudgetExceeded as exc:
            log.warning("orchestrator.budget_exceeded_at_reporter", error=str(exc))
            return {"aborted": True, "abort_reason": str(exc)}

        trace = _build_trace(
            job_id=ctx.job_id,
            claim_id="(reporter)",
            agent="Reporter",
            usage=answer.usage,
            steps=answer.steps,
        )
        await ctx.publisher.publish("step", _step_payload(trace))
        stage = await ctx.publisher.finish(_stage(ctx, "Executive summary generated"))
        return {
            "audit_report_md": answer.output.executive_summary_md,
            "traces": {trace.id: trace},
            "stages": [stage],
        }
    return node
