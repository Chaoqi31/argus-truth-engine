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

from argus.log import log
from argus.models.domain import ClaimType
from argus.orchestrator.context import _Ctx, _State

# Ranking priority for the cost-guard cap (ascending = kept first).
_IMPORTANCE_RANK = {"high": 0, "medium": 1, "low": 2}
_TYPE_RANK = {
    ClaimType.CITATION.value: 0,
    ClaimType.NUMERICAL_DATA.value: 1,
    ClaimType.TIME_SENSITIVE.value: 2,
    ClaimType.CROSS_REFERENCE.value: 3,
    ClaimType.QUALITATIVE.value: 4,
}


def _review_gate_node(
    ctx: _Ctx, *, auto_review: bool,
) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])

        # Cost guard: hard ceiling on claims sent to Phase B verification.
        # The atomizer can over-split a long report into 50+ atoms, each a
        # paid MiroMind deep-research call. Rank and keep only the top N.
        cap = ctx.settings.max_claims_to_verify
        n_extracted = len(claims)
        capped_applied = n_extracted > cap
        if capped_applied:
            ranked = sorted(
                enumerate(claims),
                key=lambda ic: (
                    _IMPORTANCE_RANK.get(ic[1].importance, 2),
                    _TYPE_RANK.get(ic[1].type.value, 4),
                    ic[0],
                ),
            )
            claims = [c for _, c in ranked[:cap]]
            log.info(
                "orchestrator.claims_capped",
                n_extracted=n_extracted,
                n_verifying=cap,
            )
            await ctx.publisher.publish(
                "claims_capped",
                {"n_extracted": n_extracted, "n_verifying": cap},
            )

        if auto_review or not claims:
            # Pass-through. If a cap was applied we MUST return the capped list
            # — returning {} would leave the full claim list in state.
            return {"claims": claims} if capped_applied else {}

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
        # No selection → keep all (already-capped) claims. Return the capped
        # list when a cap applied so the truncation survives this fallback.
        return {"claims": claims} if capped_applied else {}
    return node
