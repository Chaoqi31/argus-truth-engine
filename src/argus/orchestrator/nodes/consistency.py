"""Phase B: check cross-claim consistency and produce contradiction findings."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from argus.agents.consistency import (
    CHECK_CONSISTENCY,
    ConsistencyOutput,
    build_consistency_input,
)
from argus.engineering import BudgetExceeded
from argus.llm import Failed, FailureReason
from argus.log import log
from argus.models.domain import (
    Agent,
    Claim,
    Failure,
    FailureKind,
    Finding,
    FindingVerdict,
    ReasoningTrace,
    Stage,
)
from argus.orchestrator.assemblers import (
    _build_trace,
    _contradictions_to_findings,
    _finding_payload,
    _logical_flaws_to_findings,
    _step_payload,
)
from argus.orchestrator.context import _Ctx

_FAILED: dict[FailureReason, str] = {
    "timeout": "Consistency check timed out",
    "unparseable": "Consistency check could not parse a result",
    "request_error": "Consistency check request failed",
}

_REDUNDANT_LOGICAL_VERDICTS = {
    FindingVerdict.UNSUPPORTED_INFERENCE,
    FindingVerdict.OVERREACH,
}


def _drop_redundant_logical_findings(
    existing: list[Finding],
    logical_findings: list[Finding],
) -> list[Finding]:
    covered_claim_ids = {
        f.claim_id
        for f in existing
        if f.agent == Agent.VERIFIER
        and f.verdict not in {FindingVerdict.OK, FindingVerdict.UNCERTAIN}
    }
    return [
        f
        for f in logical_findings
        if not (
            f.agent == Agent.CONSISTENCY
            and f.verdict in _REDUNDANT_LOGICAL_VERDICTS
            and f.claim_id in covered_claim_ids
            and not f.evidence_ids
        )
    ]


def _stage(ctx: _Ctx, summary: str, n_findings: int) -> Stage:
    return Stage(
        key="consistency",
        name="Consistency",
        engine=ctx.llm.engine(CHECK_CONSISTENCY),
        summary=summary,
        metrics={"n_findings": n_findings},
    )


@dataclass(frozen=True)
class ConsistencyCheck:
    """What the consistency call produced, kept until the verifier's verdicts
    are final. Without a parsed result, `summary` says why."""

    parsed: ConsistencyOutput | None = None
    trace: ReasoningTrace | None = None
    summary: str = ""
    failure: Failure | None = None


async def check_consistency_of(ctx: _Ctx, claims: list[Claim]) -> ConsistencyCheck:
    """Run the consistency check. It reads only the claims, so it can run
    while the verifier and the skeptic work."""
    await ctx.publisher.stage(
        status="started",
        key="consistency",
        name="Consistency",
        engine=ctx.llm.engine(CHECK_CONSISTENCY),
    )
    if len(claims) < 2:
        return ConsistencyCheck(summary="Skipped consistency check — fewer than 2 claims")
    answer = await ctx.llm.ask(CHECK_CONSISTENCY, build_consistency_input(claims))
    if isinstance(answer, Failed):
        log.warning(
            "orchestrator.consistency_failed", reason=answer.reason, error=answer.detail[:300]
        )
        return ConsistencyCheck(summary=_FAILED[answer.reason])
    try:
        ctx.budget.charge(answer.usage.cost_usd)
    except BudgetExceeded as exc:
        log.warning("orchestrator.budget_exceeded_at_consistency", error=str(exc))
        return ConsistencyCheck(failure=Failure(kind=FailureKind.BUDGET, message=str(exc)))
    trace = _build_trace(
        claim_id=None,
        agent=Agent.CONSISTENCY,
        engine=answer.engine,
        usage=answer.usage,
        steps=answer.steps,
    )
    return ConsistencyCheck(parsed=answer.output, trace=trace)


async def record_consistency(
    ctx: _Ctx, check: ConsistencyCheck, findings: dict[str, Finding]
) -> dict[str, Any]:
    """Turn the check into findings against the final verifier verdicts, so a
    logical flaw on a claim the verifier already flagged is dropped."""
    if check.failure is not None:
        return {"failure": check.failure}
    if check.parsed is None or check.trace is None:
        stage = await ctx.publisher.finish(_stage(ctx, check.summary, 0))
        return {"stages": [stage]}
    trace = check.trace
    contradictions = _contradictions_to_findings(parsed=check.parsed, trace_id=trace.id)
    new_findings = contradictions + _drop_redundant_logical_findings(
        list(findings.values()),
        _logical_flaws_to_findings(parsed=check.parsed, trace_id=trace.id),
    )
    await ctx.publisher.publish("step", _step_payload(trace))
    for finding in new_findings:
        await ctx.publisher.publish("finding", _finding_payload(finding))
    stage = await ctx.publisher.finish(
        _stage(ctx, f"{len(new_findings)} cross-claim issue(s) found", len(new_findings))
    )
    return {
        "findings": {f.id: f for f in new_findings},
        "traces": {trace.id: trace},
        "stages": [stage],
    }
