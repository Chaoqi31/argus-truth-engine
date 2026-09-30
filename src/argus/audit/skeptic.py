"""The skeptic: an independent second look at the verdicts most likely to
hurt if wrong.

A high-risk verifier verdict the verifier was not confident about is handed
to MiroMind again, this time to look for counterevidence. When it finds
credible counterevidence the verdict drops to uncertain and is flagged; the
revision is a new copy of the finding under the same id.
"""
from __future__ import annotations

import asyncio

from argus.agents.skeptic import CHALLENGE, SkepticOutput, build_skeptic_input
from argus.audit.run import BudgetExceeded, Run
from argus.llm import Failed
from argus.log import log
from argus.models.domain import (
    Agent,
    Engine,
    Evidence,
    Finding,
    FindingFlag,
    FindingVerdict,
    Severity,
    SkepticCounterevidence,
    SkepticReview,
    StageKey,
)
from argus.models.job import FindingRecorded, StageFinished, StageStarted

_HIGH_RISK_VERDICTS = {
    FindingVerdict.FABRICATED,
    FindingVerdict.INACCURATE,
    FindingVerdict.OUTDATED,
    FindingVerdict.MISREPRESENTED,
}

_NOTHING_TO_CHALLENGE = "No high-risk verifier findings required independent challenge"


async def challenge(run: Run) -> None:
    run.record(StageStarted(key=StageKey.SKEPTIC, engine=Engine.MIROMIND))
    claims = {c.id: c for c in run.job.claims}
    evidences = list(run.job.evidences)
    candidates = [
        f
        for f in run.job.findings
        if f.agent == Agent.VERIFIER
        and f.verdict in _HIGH_RISK_VERDICTS
        and f.confidence < run.settings.skeptic_confidence_threshold
        and f.skeptic_review is None
        and f.claim_id in claims
    ]
    slots = asyncio.Semaphore(run.settings.skeptic_concurrency)
    reviewed: list[SkepticReview] = []

    async def review(finding: Finding) -> None:
        async with slots:
            prompt = build_skeptic_input(
                claim=claims[finding.claim_id].text,
                verdict=finding.verdict.value,
                summary=finding.summary,
                why_wrong=finding.why_wrong,
                evidence_brief=_evidence_brief(finding, evidences),
                coverage_brief=_coverage_brief(finding),
            )
            try:
                answer = (await run.ask(CHALLENGE, prompt, claim_id=finding.claim_id)).answer
            except BudgetExceeded:
                return
        if isinstance(answer, Failed):
            log.warning(
                "audit.skeptic_failed",
                finding_id=finding.id,
                reason=answer.reason,
                error=answer.detail[:300],
            )
            return
        verdict = _review(answer.output)
        reviewed.append(verdict)
        run.record(FindingRecorded(finding=challenged(finding, verdict)))

    async with asyncio.TaskGroup() as group:
        for finding in candidates:
            group.create_task(review(finding))

    statuses = [r.status for r in reviewed]
    run.record(
        StageFinished(
            key=StageKey.SKEPTIC,
            summary=(
                f"Challenged {len(reviewed)} high-risk finding(s)"
                if reviewed
                else _NOTHING_TO_CHALLENGE
            ),
            metrics={
                "n_reviewed": len(reviewed),
                "n_cleared": statuses.count("no_counterevidence"),
                "n_counterevidence_found": statuses.count("counterevidence_found"),
                "n_inconclusive": statuses.count("inconclusive"),
            },
        )
    )


def challenged(finding: Finding, review: SkepticReview) -> Finding:
    """The finding as the skeptic leaves it."""
    if review.status != "counterevidence_found":
        return finding.model_copy(update={"skeptic_review": review})
    flag = FindingFlag.SKEPTIC_COUNTEREVIDENCE
    return finding.model_copy(
        update={
            "skeptic_review": review,
            "verdict": FindingVerdict.UNCERTAIN,
            "severity": Severity.MINOR,
            "confidence": min(finding.confidence, 0.5),
            "summary": f"{finding.summary}  [Skeptic review found credible counterevidence.]",
            "flags": finding.flags if flag in finding.flags else (*finding.flags, flag),
        }
    )


def _review(parsed: SkepticOutput) -> SkepticReview:
    status = (
        parsed.status
        if parsed.status in {"no_counterevidence", "counterevidence_found", "inconclusive"}
        else "inconclusive"
    )
    return SkepticReview(
        status=status,
        summary=parsed.summary,
        recommended_verdict=parsed.recommended_verdict,
        counterevidence=tuple(
            SkepticCounterevidence(
                source=ce.source,
                url=ce.url,
                snippet=ce.snippet,
                relevance=ce.relevance,
            )
            for ce in parsed.counterevidence
        ),
    )


def _evidence_brief(finding: Finding, evidences: list[Evidence]) -> str:
    cited = [ev for ev in evidences if ev.id in finding.evidence_ids]
    return "\n".join(
        f"{i}. {ev.source_type.value} | {ev.url or ev.citation} | {ev.snippet[:500]}"
        for i, ev in enumerate(cited, start=1)
    )


def _coverage_brief(finding: Finding) -> str:
    return "\n".join(f"- {c.claim_fragment} => {c.relation}: {c.reason}" for c in finding.coverage)
