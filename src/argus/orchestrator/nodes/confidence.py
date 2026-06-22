"""Phase B node: compute algorithmic confidence breakdown for each finding."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.confidence_calculator import (
    compute_confidence_breakdown,
    count_distinct_sources,
    evaluate_sourcing,
)
from argus.models.domain import Finding
from argus.orchestrator.context import _Ctx, _State


def _confidence_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        findings = list(state.get("findings", {}).values())
        await ctx.publisher.stage(
            status="started",
            key="confidence",
            name="Confidence",
            engine="deterministic",
        )
        if not findings:
            await ctx.publisher.stage(
                status="finished",
                key="confidence",
                name="Confidence",
                engine="deterministic",
                summary="No findings needed confidence scoring",
                metrics={"n_scored": 0},
            )
            return {}
        all_evidences = state.get("evidences", [])
        updated: dict[str, Finding] = {}
        for f in findings:
            evs = [e for e in all_evidences if e.id in f.evidence_ids]
            source_count = count_distinct_sources(f, evs)
            breakdown = compute_confidence_breakdown(
                f, evs, source_count=source_count
            )
            flags = list(f.flags)
            confidence = f.confidence
            cap, flag = evaluate_sourcing(f, source_count)
            if flag:
                if flag not in flags:
                    flags.append(flag)
                if cap is not None:
                    confidence = min(confidence, cap)
            updated[f.id] = f.model_copy(
                update={
                    "confidence_breakdown": breakdown,
                    "flags": flags,
                    "confidence": confidence,
                }
            )
        await ctx.publisher.stage(
            status="finished",
            key="confidence",
            name="Confidence",
            engine="deterministic",
            summary=(
                f"Scored {len(findings)} finding(s) on 3 factors "
                "(authority · freshness · agreement)"
            ),
            metrics={"n_scored": len(findings)},
        )
        return {"findings": updated}
    return node
