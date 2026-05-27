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
        if not claims or not ctx.cheap_client:
            return {}
        try:
            checkworthy, filtered = await run_checkworthiness(ctx.cheap_client, claims)
        except Exception as exc:
            log.warning("orchestrator.checkworthiness_failed", error=str(exc)[:300])
            return {}
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
        return {"claims": checkworthy, "filtered_claims": filtered_data}
    return node
