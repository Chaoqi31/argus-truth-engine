"""Phase A node: run planner agent to extract claims from a ParsedDoc."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.planner import PLAN_PDF, PLAN_TEXT, build_planner_input
from argus.engineering import BudgetExceeded
from argus.llm import Failed
from argus.log import log
from argus.models.domain import Failure, FailureKind, Stage
from argus.orchestrator.assemblers import _build_trace, _step_payload
from argus.orchestrator.context import _Ctx, _State


def _planner_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("failure"):
            return {}
        doc = state.get("doc")
        if doc is None:
            return {"failure": Failure(kind=FailureKind.ERROR, message="no parsed document")}
        input_mode = state.get("input_mode", "pdf")
        task = PLAN_TEXT if input_mode == "text" else PLAN_PDF
        engine = ctx.llm.engine(task)
        await ctx.publisher.stage(
            status="started",
            key="planner",
            name="Planner",
            engine=engine,
        )
        answer = await ctx.llm.ask(task, build_planner_input(doc, input_mode=input_mode))
        if isinstance(answer, Failed):
            log.error(
                "orchestrator.planner_failed", reason=answer.reason, error=answer.detail[:500]
            )
            return {
                "failure": Failure(kind=FailureKind.ERROR, message=f"planner: {answer.detail}")
            }

        try:
            ctx.budget.charge(answer.usage.cost_usd)
        except BudgetExceeded as exc:
            log.error("orchestrator.budget_exceeded_at_planner", error=str(exc))
            return {"failure": Failure(kind=FailureKind.BUDGET, message=str(exc))}

        claims = answer.output.to_claims()
        trace = _build_trace(
            claim_id="(planner)",
            agent="planner",
            usage=answer.usage,
            steps=answer.steps,
        )
        await ctx.publisher.publish("step", _step_payload(trace, n_claims=len(claims)))
        stage = await ctx.publisher.finish(
            Stage(
                key="planner",
                name="Planner",
                engine=engine,
                summary=f"Extracted {len(claims)} candidate claim(s)",
                metrics={"n_claims": len(claims)},
            )
        )
        return {"claims": claims, "traces": {trace.id: trace}, "stages": [stage]}
    return node
