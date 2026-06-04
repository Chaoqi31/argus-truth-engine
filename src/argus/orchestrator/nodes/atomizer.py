"""Phase A node: atomize compound claims into atomic sub-claims."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.atomizer import run_atomizer
from argus.log import log
from argus.orchestrator.context import _Ctx, _State


def _atomizer_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        if not claims or not ctx.cheap_client:
            return {
                "original_claims": list(claims),
                "stage_summaries": {
                    "atomizer": {"n_original": len(claims), "n_atoms": len(claims)}
                },
            }
        try:
            atoms = await run_atomizer(ctx.cheap_client, claims)
        except Exception as exc:
            log.warning("orchestrator.atomizer_failed", error=str(exc)[:300])
            return {
                "original_claims": list(claims),
                "stage_summaries": {
                    "atomizer": {"n_original": len(claims), "n_atoms": len(claims)}
                },
            }
        log.info("orchestrator.atomized", n_original=len(claims), n_atoms=len(atoms))
        await ctx.publisher.publish("atomized", {
            "n_original": len(claims), "n_atoms": len(atoms),
        })
        return {
            "claims": atoms,
            "original_claims": list(claims),
            "stage_summaries": {
                "atomizer": {"n_original": len(claims), "n_atoms": len(atoms)}
            },
        }
    return node
