"""Consistency: the document checked against itself.

The check reads only the claims, so its call runs while the verifier and the
skeptic work. Its findings are recorded after them, against the final
verdicts: a logical flaw on a claim the verifier already found wrong adds
nothing and is dropped.
"""
from __future__ import annotations

from dataclasses import dataclass

from argus.agents.consistency import (
    CHECK_CONSISTENCY,
    ConsistencyOutput,
    build_consistency_input,
)
from argus.audit.run import BudgetExceeded, Run
from argus.llm import Failed, FailureReason
from argus.log import log
from argus.models.domain import Agent, Finding, FindingVerdict, StageKey, new_id
from argus.models.job import FindingRecorded, StageFinished, StageStarted

_FAILED: dict[FailureReason, str] = {
    "timeout": "Consistency check timed out",
    "unparseable": "Consistency check could not parse a result",
    "request_error": "Consistency check request failed",
}

_LOGICAL_FLAW_VERDICT: dict[str, FindingVerdict] = {
    "unsupported_inference": FindingVerdict.UNSUPPORTED_INFERENCE,
    "overreach": FindingVerdict.OVERREACH,
}

_REDUNDANT_LOGICAL_VERDICTS = {FindingVerdict.UNSUPPORTED_INFERENCE, FindingVerdict.OVERREACH}


@dataclass(frozen=True)
class ConsistencyCheck:
    """The check's result, kept until the verdicts are final. Without a
    parsed result, `summary` says why."""

    parsed: ConsistencyOutput | None = None
    trace_id: str = ""
    summary: str = ""


async def check(run: Run) -> ConsistencyCheck:
    run.record(
        StageStarted(key=StageKey.CONSISTENCY, engine=run.llm.engine(CHECK_CONSISTENCY))
    )
    claims = list(run.job.claims)
    if len(claims) < 2:
        return ConsistencyCheck(summary="Skipped consistency check — fewer than 2 claims")
    try:
        traced = await run.ask(CHECK_CONSISTENCY, build_consistency_input(claims))
    except BudgetExceeded:
        return ConsistencyCheck(summary="Skipped consistency check — the job budget was spent")
    answer = traced.answer
    if isinstance(answer, Failed):
        log.warning("audit.consistency_failed", reason=answer.reason, error=answer.detail[:300])
        return ConsistencyCheck(summary=_FAILED[answer.reason])
    return ConsistencyCheck(parsed=answer.output, trace_id=traced.trace.id)


def record_findings(run: Run, check: ConsistencyCheck) -> None:
    findings: list[Finding] = []
    if check.parsed is not None:
        findings = contradiction_findings(check.parsed, check.trace_id) + without_redundant(
            run.job.findings, logical_flaw_findings(check.parsed, check.trace_id)
        )
    for finding in findings:
        run.record(FindingRecorded(finding=finding))
    run.record(
        StageFinished(
            key=StageKey.CONSISTENCY,
            summary=check.summary or f"{len(findings)} cross-claim issue(s) found",
            metrics={"n_findings": len(findings)},
        )
    )


def contradiction_findings(parsed: ConsistencyOutput, trace_id: str) -> list[Finding]:
    """One finding per contradicting pair, keyed to the first claim; the
    summary names both, and the second keeps its own verdict elsewhere."""
    return [
        Finding(
            id=new_id("f"),
            claim_id=pair.claim_a_id,
            agent=Agent.CONSISTENCY,
            verdict=FindingVerdict.CONTRADICTION,
            severity=pair.severity,
            confidence=pair.confidence,
            summary=pair.summary,
            reasoning_trace_id=trace_id,
        )
        for pair in parsed.contradictions
    ]


def logical_flaw_findings(parsed: ConsistencyOutput, trace_id: str) -> list[Finding]:
    """One finding per logical flaw. What the claim would need to hold is its
    `why_wrong`; like contradictions, these cite no evidence."""
    return [
        Finding(
            id=new_id("f"),
            claim_id=flaw.claim_id,
            agent=Agent.CONSISTENCY,
            verdict=_LOGICAL_FLAW_VERDICT[flaw.type],
            severity=flaw.severity,
            confidence=flaw.confidence,
            summary=flaw.summary,
            why_wrong=flaw.missing,
            reasoning_trace_id=trace_id,
        )
        for flaw in parsed.logical_flaws
    ]


def without_redundant(existing: list[Finding], logical: list[Finding]) -> list[Finding]:
    """Drop an evidence-free logical flaw on a claim the verifier already
    found wrong: the verdict says more."""
    wrong = {
        f.claim_id
        for f in existing
        if f.agent == Agent.VERIFIER
        and f.verdict not in {FindingVerdict.OK, FindingVerdict.UNCERTAIN}
    }
    return [
        f
        for f in logical
        if not (
            f.verdict in _REDUNDANT_LOGICAL_VERDICTS
            and f.claim_id in wrong
            and not f.evidence_ids
        )
    ]
