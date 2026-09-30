"""Extraction: from a document to the claims a reviewer is asked about.

    plan -> atomize -> keep check-worthy -> shortlist

Each step is a pipeline stage. The shortlist is deterministic: it drops
duplicates, keeps the most important claims up to the verification cap, and
attaches the passage around each claim so verification never needs the
document again.
"""
from __future__ import annotations

import re
from pathlib import Path

from argus.agents.atomizer import ATOMIZE, atoms_from, build_atomizer_input
from argus.agents.checkworthiness import (
    CHECK_WORTHINESS,
    build_checkworthiness_input,
    split_checkworthy,
)
from argus.agents.planner import PLAN_PDF, PLAN_TEXT, build_planner_input
from argus.audit.run import AuditFailed, Run
from argus.llm import Failed
from argus.log import log
from argus.models.domain import (
    Claim,
    ClaimType,
    Engine,
    StageFilteredClaim,
    StageKey,
)
from argus.models.job import Failure, FailureKind, StageFinished, StageStarted
from argus.pdf.parser import ParsedDoc, ParsedPage

_CONTEXT_WINDOW_CHARS = 200

# Ranking for the verification cap (ascending = kept first).
_IMPORTANCE_RANK = {"high": 0, "medium": 1, "low": 2}
_TYPE_RANK = {
    ClaimType.CITATION: 0,
    ClaimType.NUMERICAL_DATA: 1,
    ClaimType.TIME_SENSITIVE: 2,
    ClaimType.CROSS_REFERENCE: 3,
    ClaimType.QUALITATIVE: 4,
}

_WS_RE = re.compile(r"\s+")


def text_document(text: str) -> ParsedDoc:
    """Pasted text as a one-page document."""
    page = ParsedPage(page_number=1, text=text, start_offset=0)
    return ParsedDoc(source_path=Path("<text-input>"), pages=(page,), full_text=text)


async def plan(run: Run, document: ParsedDoc) -> list[Claim]:
    task = PLAN_TEXT if run.job.input_mode == "text" else PLAN_PDF
    run.record(StageStarted(key=StageKey.PLANNER, engine=run.llm.engine(task)))
    answer = (
        await run.ask(task, build_planner_input(document, input_mode=run.job.input_mode))
    ).answer
    if isinstance(answer, Failed):
        log.error("audit.planner_failed", reason=answer.reason, error=answer.detail[:500])
        raise AuditFailed(Failure(kind=FailureKind.ERROR, message=f"planner: {answer.detail}"))
    claims = answer.output.to_claims()
    run.record(
        StageFinished(
            key=StageKey.PLANNER,
            summary=f"Extracted {len(claims)} candidate claim(s)",
            metrics={"n_claims": len(claims)},
        )
    )
    return claims


async def atomize(run: Run, claims: list[Claim]) -> list[Claim]:
    """Split compound claims into atomic ones. Needs DeepSeek; without it, or
    when the call fails, the claims go on as they are."""
    run.record(StageStarted(key=StageKey.ATOMIZER, engine=run.llm.engine(ATOMIZE)))
    atoms, summary = claims, f"Normalised {len(claims)} claim(s) — no splitting needed"
    if claims and run.llm.can_run(ATOMIZE):
        answer = (await run.ask(ATOMIZE, build_atomizer_input(claims))).answer
        if isinstance(answer, Failed):
            log.warning("audit.atomizer_failed", reason=answer.reason, error=answer.detail[:300])
            summary = f"Normalised {len(claims)} claim(s) — atomizer fallback"
        else:
            atoms = atoms_from(answer.output, claims)
            if len(atoms) > len(claims):
                summary = f"Split {len(claims)} into {len(atoms)} atomic claims"
    run.record(
        StageFinished(
            key=StageKey.ATOMIZER,
            summary=summary,
            metrics={"n_original": len(claims), "n_atoms": len(atoms)},
        )
    )
    return atoms


async def keep_checkworthy(run: Run, claims: list[Claim]) -> list[Claim]:
    """Drop opinions, forecasts and trivia. Needs DeepSeek, like `atomize`."""
    run.record(
        StageStarted(key=StageKey.CHECKWORTHINESS, engine=run.llm.engine(CHECK_WORTHINESS))
    )
    kept: list[Claim] = claims
    filtered: tuple[StageFilteredClaim, ...] = ()
    summary = f"{len(claims)} check-worthy · none filtered"
    if claims and run.llm.can_run(CHECK_WORTHINESS):
        answer = (
            await run.ask(CHECK_WORTHINESS, build_checkworthiness_input(claims))
        ).answer
        if isinstance(answer, Failed):
            log.warning(
                "audit.checkworthiness_failed", reason=answer.reason, error=answer.detail[:300]
            )
            summary = f"{len(claims)} check-worthy · filter fallback"
        else:
            kept, dropped = split_checkworthy(answer.output, claims)
            filtered = tuple(
                StageFilteredClaim(claim_id=c.id, text=c.text, reason=reason)
                for c, reason in dropped
            )
            if filtered:
                summary = f"{len(kept)} check-worthy · {len(filtered)} filtered out"
            else:
                summary = f"{len(kept)} check-worthy · none filtered"
    run.record(
        StageFinished(
            key=StageKey.CHECKWORTHINESS,
            summary=summary,
            metrics={"n_checkworthy": len(kept), "n_filtered": len(filtered)},
            filtered_claims=filtered,
        )
    )
    return kept


def shortlist(run: Run, claims: list[Claim], document: ParsedDoc) -> list[Claim]:
    """The review candidates: unique claims, capped at `max_claims_to_verify`,
    each with the passage around it."""
    run.record(StageStarted(key=StageKey.SHORTLIST, engine=Engine.DETERMINISTIC))
    unique = dedupe_claims(claims)
    candidates = [
        c.model_copy(update={"context": _surrounding_text(document, c)})
        for c in most_important(unique, run.settings.max_claims_to_verify)
    ]
    run.record(
        StageFinished(
            key=StageKey.SHORTLIST,
            summary=f"{len(candidates)} claim(s) shortlisted for review",
            metrics={
                "n_before": len(claims),
                "n_after": len(unique),
                "n_shortlisted": len(candidates),
            },
        )
    )
    return candidates


def dedupe_claims(claims: list[Claim]) -> list[Claim]:
    """Keep the first of claims whose text is the same up to case, whitespace
    and trailing punctuation: each would be its own paid verification. The
    atomizer can repeat a claim it already emitted verbatim as an atom."""
    seen: set[str] = set()
    out: list[Claim] = []
    for claim in claims:
        key = _WS_RE.sub(" ", claim.text.lower()).strip().rstrip(".!?,;:")
        if key not in seen:
            seen.add(key)
            out.append(claim)
    return out


def most_important(claims: list[Claim], cap: int) -> list[Claim]:
    """At most ``cap`` claims, the most important first: each one is a paid
    deep-research call, and the atomizer can split a long report into 50+."""
    if len(claims) <= cap:
        return claims
    ranked = sorted(
        enumerate(claims),
        key=lambda ic: (_IMPORTANCE_RANK.get(ic[1].importance, 2), _TYPE_RANK[ic[1].type], ic[0]),
    )
    log.info("audit.claims_capped", n_claims=len(claims), n_kept=cap)
    return [c for _, c in ranked[:cap]]


def _surrounding_text(document: ParsedDoc, claim: Claim) -> str:
    page = next((p for p in document.pages if p.page_number == claim.page), None)
    if page is None:
        return ""
    start = max(0, claim.span[0] - _CONTEXT_WINDOW_CHARS)
    end = min(len(page.text), claim.span[1] + _CONTEXT_WINDOW_CHARS)
    return page.text[start:end]
