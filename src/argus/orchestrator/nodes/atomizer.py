"""Phase A node: atomize compound claims into atomic sub-claims."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.atomizer import ATOMIZE, atoms_from, build_atomizer_input
from argus.llm import Failed
from argus.log import log
from argus.models.domain import Stage
from argus.orchestrator.context import _Ctx, _State


def _stage(n_original: int, n_atoms: int, summary: str) -> Stage:
    return Stage(
        key="atomizer",
        name="Atomizer",
        engine="deepseek",
        summary=summary,
        metrics={"n_original": n_original, "n_atoms": n_atoms},
    )


def _atomizer_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        await ctx.publisher.stage(
            status="started",
            key="atomizer",
            name="Atomizer",
            engine="deepseek",
        )
        if not claims or not ctx.llm.can_run(ATOMIZE):
            stage = await ctx.publisher.finish(
                _stage(
                    len(claims),
                    len(claims),
                    f"Normalised {len(claims)} claim(s) — no splitting needed",
                )
            )
            return {"stages": [stage]}
        answer = await ctx.llm.ask(ATOMIZE, build_atomizer_input(claims))
        if isinstance(answer, Failed):
            log.warning(
                "orchestrator.atomizer_failed", reason=answer.reason, error=answer.detail[:300]
            )
            stage = await ctx.publisher.finish(
                _stage(
                    len(claims),
                    len(claims),
                    f"Normalised {len(claims)} claim(s) — atomizer fallback",
                )
            )
            return {"stages": [stage]}
        atoms = atoms_from(answer.output, claims)
        log.info("orchestrator.atomized", n_original=len(claims), n_atoms=len(atoms))
        await ctx.publisher.publish("atomized", {
            "n_original": len(claims), "n_atoms": len(atoms),
        })
        summary = (
            f"Split {len(claims)} into {len(atoms)} atomic claims"
            if len(atoms) > len(claims)
            else f"Normalised {len(claims)} claim(s) — no splitting needed"
        )
        stage = await ctx.publisher.finish(_stage(len(claims), len(atoms), summary))
        return {"claims": atoms, "stages": [stage]}
    return node
