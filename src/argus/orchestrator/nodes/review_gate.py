"""HITL pause node — uses LangGraph interrupt() to halt Phase A → B transition.

When invoked, publishes a ``review_ready`` event listing the checkworthy
claims, then calls ``interrupt(...)``. The graph pauses; the checkpointer
persists state. The HTTP layer resumes via ``Command(resume=selected_ids)``.

If ``auto_review`` is True (no human in the loop — e.g. CLI mode), this
node is a no-op pass-through.
"""
from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any

from langgraph.types import interrupt

from argus.log import log
from argus.models.domain import Claim, ClaimType
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

_WS_RE = re.compile(r"\s+")


def _normalize_claim_text(text: str) -> str:
    """Canonical form for duplicate detection — case-, whitespace-, and
    trailing-punctuation-insensitive. Two claims that normalize to the same
    string are the same verification and must not each cost a MiroMind call."""
    return _WS_RE.sub(" ", text.lower()).strip().rstrip(".!?,;:")


def _dedupe_claims(claims: list[Claim]) -> list[Claim]:
    """Drop later claims whose normalized text repeats an earlier one.

    The atomizer can split a compound claim into atoms that duplicate claims it
    already emitted verbatim (e.g. "Margins were 32%." surfacing as both an
    original claim and an atom), and nothing downstream dedupes — so each
    duplicate would fire its own paid MiroMind verification. Keep first
    occurrence; preserve order. Genuinely distinct claims (a citation vs the
    bare number it contains) normalize differently and are both kept.
    """
    seen: set[str] = set()
    out: list[Claim] = []
    for c in claims:
        key = _normalize_claim_text(c.text)
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def _review_gate_node(
    ctx: _Ctx, *, auto_review: bool,
) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        n_before = len(claims)
        publish_stage = not ctx.is_resuming
        if publish_stage:
            await ctx.publisher.stage(
                status="started",
                key="review_gate",
                name="Review gate",
                engine="deterministic",
            )

        # Dedupe before the paid verification step. The atomizer can emit atoms
        # that duplicate existing claims verbatim and nothing downstream
        # dedupes, so each duplicate would otherwise cost its own MiroMind call.
        deduped = _dedupe_claims(claims)
        dedup_applied = len(deduped) < len(claims)
        if dedup_applied:
            log.info("orchestrator.claims_deduped",
                     n_before=len(claims), n_after=len(deduped))
            await ctx.publisher.publish(
                "claims_deduped",
                {"n_before": len(claims), "n_after": len(deduped)},
            )
        claims = deduped

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

        # Per-stage summary for the UI. `claims` here is the post-dedup,
        # post-cap list that actually goes to verification.
        review_summary = {
            "review_gate": {
                "n_before": n_before,
                "n_after": len(deduped),
                "n_verifying": len(claims),
            }
        }
        review_stage_payload = review_summary["review_gate"]
        stage_finished = False

        async def finish_stage(n_verifying: int) -> None:
            nonlocal stage_finished
            if not publish_stage:
                return
            if stage_finished:
                return
            stage_finished = True
            await ctx.publisher.stage(
                status="finished",
                key="review_gate",
                name="Review gate",
                engine="deterministic",
                summary=f"{n_verifying} claim(s) sent to verification",
                metrics={
                    "n_before": n_before,
                    "n_after": len(deduped),
                    "n_verifying": n_verifying,
                },
            )

        if auto_review or not claims:
            # Pass-through. If a cap was applied we MUST return the capped list
            # — returning {} would leave the full claim list in state.
            await finish_stage(review_stage_payload["n_verifying"])
            if capped_applied or dedup_applied:
                return {"claims": claims, "stage_summaries": review_summary}
            return {"stage_summaries": review_summary}

        # LangGraph interrupt() is replay-based: when Command(resume=...)
        # arrives, this node body re-executes from the top. The original
        # invocation (audit_pdf/audit_text) already published
        # "review_ready" once; trace_bus history serves it to
        # reconnecting clients. Skip the re-publish on resume to avoid
        # the duplicate arriving AFTER the user has already submitted.
        if not ctx.is_resuming:
            await finish_stage(len(claims))
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
            await finish_stage(len(filtered))
            return {
                "claims": filtered,
                "stage_summaries": {
                    "review_gate": {
                        "n_before": n_before,
                        "n_after": len(deduped),
                        "n_verifying": len(filtered),
                    }
                },
            }
        await ctx.publisher.publish("review_submitted",
                                    {"n_selected": len(claims), "auto": True})
        # No selection → keep all (already-capped) claims. Return the capped
        # list when a cap applied so the truncation survives this fallback.
        await finish_stage(review_stage_payload["n_verifying"])
        if capped_applied or dedup_applied:
            return {"claims": claims, "stage_summaries": review_summary}
        return {"stage_summaries": review_summary}
    return node
