"""Phase B node: compute algorithmic confidence breakdown for each finding."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.confidence_calculator import (
    compute_confidence_breakdown,
    count_distinct_sources,
    evaluate_sourcing,
)
from argus.models.domain import Finding, Stage
from argus.orchestrator.context import _Ctx, _State


def _stage(summary: str, n_scored: int) -> Stage:
    return Stage(
        key="confidence",
        name="Confidence",
        engine="deterministic",
        summary=summary,
        metrics={"n_scored": n_scored},
    )


def _confidence_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("failure"):
            return {}
        findings = list(state.get("findings", {}).values())
        await ctx.publisher.stage(
            status="started",
            key="confidence",
            name="Confidence",
            engine="deterministic",
        )
        if not findings:
            stage = await ctx.publisher.finish(
                _stage("No findings needed confidence scoring", 0)
            )
            return {"stages": [stage]}
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
        stage = await ctx.publisher.finish(
            _stage(
                f"Scored {len(findings)} finding(s) on 3 factors "
                "(authority · freshness · agreement)",
                len(findings),
            )
        )
        return {"findings": updated, "stages": [stage]}
    return node
