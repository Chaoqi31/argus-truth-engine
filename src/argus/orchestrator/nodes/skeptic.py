"""Phase B node: independently challenge high-risk verifier findings."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.skeptic import CHALLENGE, SkepticOutput, build_skeptic_input
from argus.agents.unified_verifier import VERIFIER_VERSION
from argus.cache.key import claim_cache_key
from argus.engineering import BudgetExceeded, make_idempotency_key
from argus.llm import Answer, Failed
from argus.log import log
from argus.models.domain import (
    Claim,
    Evidence,
    Failure,
    FailureKind,
    Finding,
    FindingVerdict,
    ReasoningTrace,
    Severity,
    SkepticCounterevidence,
    SkepticReview,
    Stage,
)
from argus.orchestrator.assemblers import _build_trace, _finding_payload, _step_payload
from argus.orchestrator.context import _Ctx, _State

_HIGH_RISK_VERDICTS = {
    FindingVerdict.FABRICATED,
    FindingVerdict.INACCURATE,
    FindingVerdict.OUTDATED,
    FindingVerdict.MISREPRESENTED,
}


def _evidence_brief(finding: Finding, evidences: list[Evidence]) -> str:
    rows: list[str] = []
    for i, ev in enumerate(evidences, start=1):
        if ev.id not in finding.evidence_ids:
            continue
        rows.append(
            f"{i}. {ev.source_type.value} | {ev.url or ev.citation} | {ev.snippet[:500]}"
        )
    return "\n".join(rows)


def _coverage_brief(finding: Finding) -> str:
    return "\n".join(
        f"- {c.claim_fragment} => {c.relation}: {c.reason}"
        for c in finding.coverage
    )


def _to_domain_review(parsed: SkepticOutput) -> SkepticReview:
    status = (
        parsed.status
        if parsed.status in {"no_counterevidence", "counterevidence_found", "inconclusive"}
        else "inconclusive"
    )
    return SkepticReview(
        status=status,
        summary=parsed.summary,
        recommended_verdict=parsed.recommended_verdict,
        counterevidence=[
            SkepticCounterevidence(
                source=ce.source,
                url=ce.url,
                snippet=ce.snippet,
                relevance=ce.relevance,
            )
            for ce in parsed.counterevidence
        ],
    )


def _apply_skeptic_effect(finding: Finding, review: SkepticReview) -> Finding:
    if review.status != "counterevidence_found":
        return finding.model_copy(update={"skeptic_review": review})
    flag = "skeptic counterevidence found"
    return finding.model_copy(
        update={
            "skeptic_review": review,
            "verdict": FindingVerdict.UNCERTAIN,
            "severity": Severity.MINOR,
            "confidence": min(finding.confidence, 0.5),
            "summary": f"{finding.summary}  [Skeptic review found credible counterevidence.]",
            "flags": finding.flags if flag in finding.flags else [*finding.flags, flag],
        }
    )


def _stage(summary: str, reviewed: list[Finding]) -> Stage:
    statuses = [f.skeptic_review.status for f in reviewed if f.skeptic_review]
    return Stage(
        key="skeptic",
        name="Skeptic challenge",
        engine="miromind",
        summary=summary,
        metrics={
            "n_reviewed": len(reviewed),
            "n_cleared": statuses.count("no_counterevidence"),
            "n_counterevidence_found": statuses.count("counterevidence_found"),
            "n_inconclusive": statuses.count("inconclusive"),
        },
    )


_NOTHING_TO_CHALLENGE = "No high-risk verifier findings required independent challenge"


def _skeptic_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("failure"):
            return {}
        await ctx.publisher.stage(
            status="started",
            key="skeptic",
            name="Skeptic challenge",
            engine="miromind",
        )

        findings = [
            f for f in state.get("findings", {}).values()
            if f.agent == "UnifiedVerifier"
            and f.verdict in _HIGH_RISK_VERDICTS
            and f.confidence < ctx.settings.skeptic_confidence_threshold
            and f.skeptic_review is None
        ]
        if not findings:
            stage = await ctx.publisher.finish(_stage(_NOTHING_TO_CHALLENGE, []))
            return {"stages": [stage]}

        claims_by_id: dict[str, Claim] = {c.id: c for c in state.get("claims", [])}
        evidences = state.get("evidences", [])
        runner = ctx.runners["skeptic"]

        async def challenge(finding: Finding, claim: Claim) -> Answer[SkepticOutput]:
            async with runner.acquire():
                return await ctx.llm.ask(
                    CHALLENGE,
                    build_skeptic_input(
                        claim=claim.text,
                        verdict=finding.verdict.value,
                        summary=finding.summary,
                        why_wrong=finding.why_wrong,
                        evidence_brief=_evidence_brief(finding, evidences),
                        coverage_brief=_coverage_brief(finding),
                    ),
                    idempotency_key=make_idempotency_key(ctx.job_id, "Skeptic", finding.id),
                )

        candidates = [
            (f, claims_by_id[f.claim_id]) for f in findings if f.claim_id in claims_by_id
        ]
        answers = await asyncio.gather(*(challenge(f, c) for f, c in candidates))

        revised: dict[str, Finding] = {}
        traces: dict[str, ReasoningTrace] = {}
        for (finding, claim), answer in zip(candidates, answers, strict=True):
            if isinstance(answer, Failed):
                log.warning(
                    "orchestrator.skeptic_failed",
                    finding_id=finding.id,
                    reason=answer.reason,
                    error=answer.detail[:300],
                )
                continue
            try:
                ctx.budget.charge(answer.usage.cost_usd)
            except BudgetExceeded as exc:
                log.warning("orchestrator.budget_exceeded_at_skeptic", error=str(exc))
                return {
                    "failure": Failure(kind=FailureKind.BUDGET, message=str(exc)),
                    "findings": revised,
                    "traces": traces,
                }

            trace = _build_trace(
                job_id=ctx.job_id,
                claim_id=finding.claim_id,
                agent="Skeptic",
                usage=answer.usage,
                steps=answer.steps,
            )
            traces[trace.id] = trace
            challenged = _apply_skeptic_effect(finding, _to_domain_review(answer.output))
            revised[challenged.id] = challenged
            await ctx.publisher.publish("step", _step_payload(trace))
            await ctx.publisher.publish("finding", _finding_payload(challenged))

            if ctx.cache is not None:
                key = claim_cache_key(
                    claim.text, domain=ctx.content_domain, version=VERIFIER_VERSION,
                )
                await ctx.cache.put(
                    key,
                    finding=challenged,
                    evidences=[e for e in evidences if e.id in challenged.evidence_ids],
                    verifier_version=VERIFIER_VERSION,
                    content_domain=ctx.content_domain,
                    time_sensitive=(claim.type.value == "time-sensitive"),
                )

        reviewed = list(revised.values())
        stage = await ctx.publisher.finish(
            _stage(
                f"Challenged {len(reviewed)} high-risk finding(s)"
                if reviewed
                else _NOTHING_TO_CHALLENGE,
                reviewed,
            )
        )
        return {"findings": revised, "traces": traces, "stages": [stage]}

    return node
