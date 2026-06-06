"""Phase A node: filter claims by checkworthiness."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.checkworthiness import run_checkworthiness
from argus.log import log
from argus.orchestrator.context import _Ctx, _State


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
        if not claims or not ctx.cheap_client:
            await ctx.publisher.stage(
                status="finished",
                key="checkworthiness",
                name="Check-worthiness",
                engine="deepseek",
                summary=f"{len(claims)} check-worthy · none filtered",
                metrics={"n_checkworthy": len(claims), "n_filtered": 0},
            )
            return {
                "stage_summaries": {
                    "checkworthiness": {
                        "n_checkworthy": len(claims), "n_filtered": 0,
                    }
                }
            }
        try:
            checkworthy, filtered = await run_checkworthiness(ctx.cheap_client, claims)
        except Exception as exc:
            log.warning("orchestrator.checkworthiness_failed", error=str(exc)[:300])
            await ctx.publisher.stage(
                status="finished",
                key="checkworthiness",
                name="Check-worthiness",
                engine="deepseek",
                summary=f"{len(claims)} check-worthy · filter fallback",
                metrics={"n_checkworthy": len(claims), "n_filtered": 0},
            )
            return {
                "stage_summaries": {
                    "checkworthiness": {
                        "n_checkworthy": len(claims), "n_filtered": 0,
                    }
                }
            }
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
        await ctx.publisher.stage(
            status="finished",
            key="checkworthiness",
            name="Check-worthiness",
            engine="deepseek",
            summary=summary,
            metrics={"n_checkworthy": len(checkworthy), "n_filtered": len(filtered)},
        )
        return {
            "claims": checkworthy,
            "filtered_claims": filtered_data,
            "stage_summaries": {
                "checkworthiness": {
                    "n_checkworthy": len(checkworthy), "n_filtered": len(filtered),
                }
            },
        }
    return node
