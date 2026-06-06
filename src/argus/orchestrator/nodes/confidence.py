"""Phase B node: compute algorithmic confidence breakdown for each finding.

NOTE: We mutate findings in-place rather than returning them through the
state reducer (``Annotated[list[Finding], operator.add]``), because the
add-reducer would *duplicate* findings instead of replacing them.  This
is safe as long as LangGraph passes the same Python objects (true for
in-process ``StateGraph`` without checkpointing).  If checkpointing is
added later, switch ``findings`` to a dict-based reducer keyed by ID.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.confidence_calculator import (
    compute_confidence_breakdown,
    count_distinct_sources,
    evaluate_sourcing,
)
from argus.orchestrator.context import _Ctx, _State


def _confidence_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    """Compute algorithmic confidence breakdown for each finding.

    NOTE: We mutate findings in-place rather than returning them through the
    state reducer (``Annotated[list[Finding], operator.add]``), because the
    add-reducer would *duplicate* findings instead of replacing them.  This
    is safe as long as LangGraph passes the same Python objects (true for
    in-process ``StateGraph`` without checkpointing).  If checkpointing is
    added later, switch ``findings`` to a dict-based reducer keyed by ID.
    """
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        findings = state.get("findings", [])
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
        for f in findings:
            evs = [e for e in all_evidences if e.id in f.evidence_ids]
            source_count = count_distinct_sources(f, evs)
            f.confidence_breakdown = compute_confidence_breakdown(
                f, evs, source_count=source_count
            )
            # Soft ≥2-source enforcement: cap headline confidence + flag the
            # finding when a verdict rests on too few independent sources.
            cap, flag = evaluate_sourcing(f, source_count)
            if flag:
                if flag not in f.flags:
                    f.flags.append(flag)
                if cap is not None:
                    f.confidence = min(f.confidence, cap)
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
        return {}
    return node
