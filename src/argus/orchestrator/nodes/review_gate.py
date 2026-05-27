"""HITL pause node — uses LangGraph interrupt() to halt Phase A → B transition.

When invoked, publishes a ``review_ready`` event listing the checkworthy
claims, then calls ``interrupt(...)``. The graph pauses; the checkpointer
persists state. The HTTP layer resumes via ``Command(resume=selected_ids)``.

If ``auto_review`` is True (no human in the loop — e.g. CLI mode), this
node is a no-op pass-through.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from langgraph.types import interrupt

from argus.orchestrator.context import _Ctx, _State


def _review_gate_node(
    ctx: _Ctx, *, auto_review: bool,
) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        if auto_review or not claims:
            return {}  # straight through

        # LangGraph interrupt() is replay-based: when Command(resume=...)
        # arrives, this node body re-executes from the top. The original
        # invocation (audit_pdf/audit_text) already published
        # "review_ready" once; trace_bus history serves it to
        # reconnecting clients. Skip the re-publish on resume to avoid
        # the duplicate arriving AFTER the user has already submitted.
        if not ctx.is_resuming:
            await ctx.publisher.publish("review_ready", {
                "claims": [
                    {"id": c.id, "text": c.text, "type": c.type.value,
                     "importance": c.importance,
                     "parent_claim_id": c.parent_claim_id}
                    for c in claims
                ],
                "filtered": state.get("filtered_claims", []),
                "n_checkworthy": len(claims),
            })

        # interrupt() raises an internal signal LangGraph catches; the
        # graph pauses and the checkpointer persists state. Resume via
        # Command(resume=selected_ids).
        selected_ids: list[str] | None = interrupt({"awaiting": "review"})

        if selected_ids is not None:
            selected_set = set(selected_ids)
            filtered = [c for c in claims if c.id in selected_set]
            await ctx.publisher.publish("review_submitted",
                                        {"n_selected": len(filtered)})
            return {"claims": filtered}
        await ctx.publisher.publish("review_submitted",
                                    {"n_selected": len(claims), "auto": True})
        return {}
    return node
