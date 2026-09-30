"""Phase A node: filter claims by checkworthiness."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.checkworthiness import (
    CHECK_WORTHINESS,
    build_checkworthiness_input,
    split_checkworthy,
)
from argus.llm import Failed
from argus.log import log
from argus.models.domain import Stage, StageFilteredClaim
from argus.orchestrator.context import _Ctx, _State


def _stage(
    n_checkworthy: int,
    summary: str,
    filtered: list[StageFilteredClaim] | None = None,
) -> Stage:
    return Stage(
        key="checkworthiness",
        name="Check-worthiness",
        engine="deepseek",
        summary=summary,
        metrics={"n_checkworthy": n_checkworthy, "n_filtered": len(filtered or [])},
        filtered_claims=filtered,
    )


def _checkworthiness_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        await ctx.publisher.stage(
            status="started",
            key="checkworthiness",
            name="Check-worthiness",
            engine="deepseek",
        )
        if not claims or not ctx.llm.can_run(CHECK_WORTHINESS):
            stage = await ctx.publisher.finish(
                _stage(len(claims), f"{len(claims)} check-worthy · none filtered")
            )
            return {"stages": [stage]}
        answer = await ctx.llm.ask(CHECK_WORTHINESS, build_checkworthiness_input(claims))
        if isinstance(answer, Failed):
            log.warning(
                "orchestrator.checkworthiness_failed",
                reason=answer.reason,
                error=answer.detail[:300],
            )
            stage = await ctx.publisher.finish(
                _stage(len(claims), f"{len(claims)} check-worthy · filter fallback")
            )
            return {"stages": [stage]}
        checkworthy, filtered = split_checkworthy(answer.output, claims)
        filtered_data = [
            {"claim_id": c.id, "text": c.text, "reason": reason}
            for c, reason in filtered
        ]
        log.info("orchestrator.filtered", n_checkworthy=len(checkworthy),
                 n_filtered=len(filtered))
        await ctx.publisher.publish("filtered", {
            "n_checkworthy": len(checkworthy),
            "n_filtered": len(filtered),
        })
        summary = (
            f"{len(checkworthy)} check-worthy · none filtered"
            if not filtered
            else f"{len(checkworthy)} check-worthy · {len(filtered)} filtered out"
        )
        stage = await ctx.publisher.finish(
            _stage(
                len(checkworthy),
                summary,
                [StageFilteredClaim(**f) for f in filtered_data] if filtered_data else None,
            )
        )
        return {"claims": checkworthy, "filtered_claims": filtered_data, "stages": [stage]}
    return node
