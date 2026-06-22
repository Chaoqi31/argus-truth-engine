"""Phase B node: independently challenge high-risk verifier findings."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.agents.base import JsonRepairFailed
from argus.agents.skeptic import run_skeptic
from argus.agents.unified_verifier import VERIFIER_VERSION
from argus.cache.key import claim_cache_key
from argus.engineering import BudgetExceeded, make_idempotency_key
from argus.log import log
from argus.models.domain import (
    Claim,
    Evidence,
    Finding,
    FindingVerdict,
    ReasoningTrace,
    Severity,
    SkepticCounterevidence,
    SkepticReview,
)
from argus.orchestrator.assemblers import _build_trace, _finding_payload, _step_payload
from argus.orchestrator.context import _charge_result, _Ctx, _State

_HIGH_RISK_VERDICTS = {
    FindingVerdict.FABRICATED,
    FindingVerdict.INACCURATE,
    FindingVerdict.OUTDATED,
    FindingVerdict.MISREPRESENTED,
    FindingVerdict.MISMATCH,
    FindingVerdict.STALE,
    FindingVerdict.SUPERSEDED,
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


def _to_domain_review(parsed: Any) -> SkepticReview:
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


def _apply_skeptic_effect(finding: Finding, review: SkepticReview) -> None:
    finding.skeptic_review = review
    if review.status != "counterevidence_found":
        return
    finding.verdict = FindingVerdict.UNCERTAIN
    finding.severity = Severity.MINOR
    finding.confidence = min(finding.confidence, 0.5)
    finding.summary = f"{finding.summary}  [Skeptic review found credible counterevidence.]"
    if "skeptic counterevidence found" not in finding.flags:
        finding.flags.append("skeptic counterevidence found")


def _skeptic_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
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
            await ctx.publisher.stage(
                status="finished",
                key="skeptic",
                name="Skeptic challenge",
                engine="miromind",
                summary="No high-risk verifier findings required independent challenge",
                metrics={
                    "n_reviewed": 0,
                    "n_cleared": 0,
                    "n_counterevidence_found": 0,
                    "n_inconclusive": 0,
                },
            )
            return {}

        claims_by_id: dict[str, Claim] = {c.id: c for c in state.get("claims", [])}
        evidences = state.get("evidences", [])
        runner = ctx.runners["skeptic"]
        traces: dict[str, ReasoningTrace] = {}

        for finding in findings:
            claim = claims_by_id.get(finding.claim_id)
            if claim is None:
                continue
            async with runner.acquire():
                try:
                    result = await run_skeptic(
                        ctx.client,
                        claim=claim.text,
                        verdict=finding.verdict.value,
                        summary=finding.summary,
                        why_wrong=finding.why_wrong,
                        evidence_brief=_evidence_brief(finding, evidences),
                        coverage_brief=_coverage_brief(finding),
                        idempotency_key=make_idempotency_key(
                            ctx.job_id, "Skeptic", finding.id
                        ),
                    )
                except JsonRepairFailed as exc:
                    log.warning(
                        "orchestrator.skeptic_failed",
                        finding_id=finding.id,
                        error=str(exc)[:300],
                    )
                    continue
                except BudgetExceeded:
                    raise
                except Exception as exc:
                    log.warning(
                        "orchestrator.skeptic_failed",
                        finding_id=finding.id,
                        error_type=type(exc).__name__,
                        error=str(exc)[:300],
                    )
                    continue

            try:
                _charge_result(ctx, result)
            except BudgetExceeded as exc:
                log.warning("orchestrator.budget_exceeded_at_skeptic", error=str(exc))
                return {"aborted": True, "abort_reason": str(exc)}

            trace = _build_trace(
                job_id=ctx.job_id,
                claim_id=finding.claim_id,
                agent="Skeptic",
                stream=result.final,
            )
            traces[trace.id] = trace
            review = _to_domain_review(result.parsed)
            _apply_skeptic_effect(finding, review)
            await ctx.publisher.publish("step", _step_payload(trace))
            await ctx.publisher.publish("finding", _finding_payload(finding))

            if ctx.cache is not None:
                key = claim_cache_key(
                    claim.text, domain=ctx.content_domain, version=VERIFIER_VERSION,
                )
                await ctx.cache.put(
                    key,
                    finding=finding,
                    evidences=[e for e in evidences if e.id in finding.evidence_ids],
                    verifier_version=VERIFIER_VERSION,
                    content_domain=ctx.content_domain,
                    time_sensitive=(claim.type.value == "time-sensitive"),
                )

        reviewed = [
            f for f in findings
            if f.skeptic_review is not None
        ]
        n_counterevidence = sum(
            1 for f in reviewed
            if f.skeptic_review and f.skeptic_review.status == "counterevidence_found"
        )
        n_cleared = sum(
            1 for f in reviewed
            if f.skeptic_review and f.skeptic_review.status == "no_counterevidence"
        )
        n_inconclusive = sum(
            1 for f in reviewed
            if f.skeptic_review and f.skeptic_review.status == "inconclusive"
        )
        await ctx.publisher.stage(
            status="finished",
            key="skeptic",
            name="Skeptic challenge",
            engine="miromind",
            summary=(
                "No high-risk verifier findings required independent challenge"
                if not reviewed
                else f"Challenged {len(reviewed)} high-risk finding(s)"
            ),
            metrics={
                "n_reviewed": len(reviewed),
                "n_cleared": n_cleared,
                "n_counterevidence_found": n_counterevidence,
                "n_inconclusive": n_inconclusive,
            },
        )
        return {"findings": {f.id: f for f in reviewed}, "traces": traces}

    return node
