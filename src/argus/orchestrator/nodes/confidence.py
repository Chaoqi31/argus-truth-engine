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

from argus.agents.confidence_calculator import compute_confidence_breakdown
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
        if not findings:
            return {}
        all_evidences = state.get("evidences", [])
        for f in findings:
            evs = [e for e in all_evidences if e.id in f.evidence_ids]
            f.confidence_breakdown = compute_confidence_breakdown(f, evs)
        return {}
    return node
