"""Review gate: the last extraction stage before paid verification.

Dedupes the candidate claims, caps how many go on to verification, attaches
each claim's surrounding text, and announces the shortlist for human review
with a ``review_ready`` event unless ``auto_review`` is set. Whether the run
pauses for that review is the pipeline's decision, not this node's.
"""
from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any

from argus.log import log
from argus.models.domain import Claim, ClaimType, Stage
from argus.orchestrator.assemblers import _surrounding_text
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
        if len(deduped) < len(claims):
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
        if n_extracted > cap:
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

        doc = state.get("doc")
        claims = [c.model_copy(update={"context": _surrounding_text(doc, c)}) for c in claims]

        stage = await ctx.publisher.finish(
            Stage(
                key="review_gate",
                name="Review gate",
                engine="deterministic",
                summary=f"{len(claims)} claim(s) sent to verification",
                metrics={
                    "n_before": n_before,
                    "n_after": len(deduped),
                    "n_verifying": len(claims),
                },
            )
        )
        if not auto_review and claims:
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
        return {"claims": claims, "stages": [stage]}
    return node
