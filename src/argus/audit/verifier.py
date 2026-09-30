"""Verification: every selected claim researched by MiroMind, or reused.

A claim whose verdict is cached replays the cached research instead of
paying for it again. A claim MiroMind could not finish still gets a finding,
uncertain and flagged, on the trace of the attempt. Once the job budget is
spent, the claims not yet started are left unaudited.
"""
from __future__ import annotations

import asyncio

from argus.agents.domain_hints import get_domain_hint
from argus.agents.unified_verifier import (
    VERIFIER_VERSION,
    VERIFY,
    UnifiedVerifierOutput,
    build_verifier_input,
)
from argus.audit.run import BudgetExceeded, Run
from argus.cache.finding_cache import CachedVerdict
from argus.cache.key import claim_cache_key
from argus.llm import Failed, FailureReason
from argus.log import log
from argus.models.domain import (
    Agent,
    Claim,
    ClaimCoverage,
    ClaimType,
    ComputationCheck,
    ComputationValue,
    CorrectedInfo,
    Engine,
    Evidence,
    EvidenceQuality,
    EvidenceSource,
    Finding,
    FindingFlag,
    FindingVerdict,
    ReasoningTrace,
    Severity,
    StageKey,
    StepType,
    VerificationStep,
    new_id,
)
from argus.models.job import FindingRecorded, StageFinished, StageStarted

# Summary and flag of the uncertain finding that stands in for a claim the
# verifier could not finish, so the claim still shows in results and report.
_FAILED: dict[FailureReason, tuple[str, FindingFlag]] = {
    "timeout": (
        "Verification timed out before MiroMind returned a complete result.",
        FindingFlag.VERIFIER_TIMED_OUT,
    ),
    "unparseable": (
        "Verification could not be completed — the verifier's response could "
        "not be parsed into a valid result.",
        FindingFlag.VERIFIER_UNPARSEABLE,
    ),
    "request_error": (
        "Verification could not be completed — the request to MiroMind failed.",
        FindingFlag.VERIFIER_REQUEST_FAILED,
    ),
}

_UNIFIED_SEVERITY: dict[FindingVerdict, Severity] = {
    FindingVerdict.FABRICATED: Severity.MAJOR,
    FindingVerdict.INACCURATE: Severity.MAJOR,
    FindingVerdict.OUTDATED: Severity.MAJOR,
    FindingVerdict.MISREPRESENTED: Severity.CRITICAL,
    FindingVerdict.OK: Severity.MINOR,
    FindingVerdict.UNCERTAIN: Severity.MINOR,
    FindingVerdict.CONTRADICTION: Severity.MAJOR,
    FindingVerdict.UNSUPPORTED_INFERENCE: Severity.MAJOR,
    FindingVerdict.OVERREACH: Severity.MAJOR,
}


async def verify_claims(run: Run) -> None:
    claims = list(run.job.claims)
    run.record(StageStarted(key=StageKey.VERIFY, engine=Engine.MIROMIND))
    domain = run.job.content_domain.value
    slots = asyncio.Semaphore(run.settings.unified_verifier_concurrency)
    researched: list[ReasoningTrace] = []

    async def verify(claim: Claim) -> None:
        async with slots:
            if run.cache is not None:
                hit = await run.cache.get(_cache_key(claim, domain))
                if hit is not None:
                    reused = hit.for_claim(claim.id)
                    run.replay(reused.trace)
                    run.record(
                        FindingRecorded(finding=reused.finding, evidences=reused.evidences)
                    )
                    return
            prompt = build_verifier_input(
                claim.text,
                claim.context,
                get_domain_hint(claim_type=claim.type, content_domain=domain),
            )
            try:
                traced = await run.ask(VERIFY, prompt, claim_id=claim.id)
            except BudgetExceeded:
                return
            researched.append(traced.trace)
            answer = traced.answer
            if isinstance(answer, Failed):
                log.warning(
                    "audit.verifier_failed",
                    claim_id=claim.id,
                    reason=answer.reason,
                    error=answer.detail[:300],
                )
                run.record(FindingRecorded(finding=failed_finding(claim, answer, traced.trace.id)))
                return
            finding, evidences = verdict_finding(
                claim=claim, parsed=answer.output, trace=traced.trace
            )
            run.record(FindingRecorded(finding=finding, evidences=tuple(evidences)))

    async with asyncio.TaskGroup() as group:
        for claim in claims:
            group.create_task(verify(claim))

    n_claims = run.job.claims_audited
    n_steps = sum(len(t.steps) for t in researched)
    n_searches = sum(1 for t in researched for s in t.steps if s.type is StepType.WEB_SEARCH)
    run.record(
        StageFinished(
            key=StageKey.VERIFY,
            summary=(
                f"Deep-researched {n_claims} claim(s) · {n_steps} steps · "
                f"{n_searches} web searches"
            ),
            metrics={"n_claims": n_claims, "n_steps": n_steps, "n_searches": n_searches},
        )
    )


async def remember(run: Run) -> None:
    """Cache each verdict this job paid for, as the skeptic left it, with its
    evidence and trace. Uncertain verdicts are often transient, so a later
    job verifies those again."""
    if run.cache is None:
        return
    domain = run.job.content_domain.value
    claims = {c.id: c for c in run.job.claims}
    evidences = {e.id: e for e in run.job.evidences}
    for finding in list(run.job.findings):
        if (
            finding.agent != Agent.VERIFIER
            or finding.from_cache
            or finding.verdict == FindingVerdict.UNCERTAIN
        ):
            continue
        claim = claims[finding.claim_id]
        await run.cache.put(
            _cache_key(claim, domain),
            CachedVerdict(
                finding=finding,
                evidences=tuple(evidences[i] for i in finding.evidence_ids),
                trace=run.job.trace(finding.reasoning_trace_id),
            ),
            verifier_version=VERIFIER_VERSION,
            content_domain=domain,
            time_sensitive=claim.type == ClaimType.TIME_SENSITIVE,
        )


def failed_finding(claim: Claim, answer: Failed, trace_id: str) -> Finding:
    summary, flag = _FAILED[answer.reason]
    # Say why it failed, briefly; the full payload stays out.
    if answer.reason == "unparseable":
        summary += f" (parser error: {answer.detail[:120]})"
    elif answer.reason == "request_error":
        summary += f" ({answer.detail[:120]})"
    return Finding(
        id=new_id("f"),
        claim_id=claim.id,
        agent=Agent.VERIFIER,
        verdict=FindingVerdict.UNCERTAIN,
        confidence=0.0,
        summary=summary,
        reasoning_trace_id=trace_id,
        flags=(flag,),
    )


def _cache_key(claim: Claim, domain: str) -> str:
    return claim_cache_key(claim.text, domain=domain, version=VERIFIER_VERSION)


def _coerce_evidence_source(raw: str) -> EvidenceSource:
    """MiroMind's free-form source type, or a web page when it names none we know."""
    try:
        return EvidenceSource(raw)
    except ValueError:
        return EvidenceSource.WEB_PAGE


def verdict_finding(
    *,
    claim: Claim,
    parsed: UnifiedVerifierOutput,
    trace: ReasoningTrace,
) -> tuple[Finding, list[Evidence]]:
    evidence_records: list[Evidence] = []
    evidence_ids: list[str] = []
    for ev in parsed.evidence:
        coerced = _coerce_evidence_source(ev.source_type)
        e = Evidence(
            id=new_id("ev"),
            source_type=coerced,
            url=ev.url,
            citation=ev.url or f"{coerced.value} query",
            snippet=ev.snippet,
            retrieved_by_step_id=trace.steps[-1].id if trace.steps else "n/a",
        )
        evidence_records.append(e)
        evidence_ids.append(e.id)

    def evidence_id_at(index: int | None) -> str | None:
        if index is None or index < 0 or index >= len(evidence_records):
            return None
        return evidence_records[index].id

    evidence_quality: list[EvidenceQuality] = []
    for q in parsed.evidence_quality:
        evidence_id = evidence_id_at(q.evidence_index)
        if evidence_id is None:
            continue
        evidence_quality.append(
            EvidenceQuality(
                evidence_id=evidence_id,
                authority=q.authority,
                independence=q.independence,
                freshness=q.freshness,
                directness=q.directness,
                role=q.role,
                rationale=q.rationale,
            )
        )

    coverage: list[ClaimCoverage] = []
    for c in parsed.coverage:
        coverage.append(
            ClaimCoverage(
                claim_fragment=c.claim_fragment,
                relation=c.relation,
                evidence_ids=[
                    evidence_records[i].id
                    for i in c.evidence_indices
                    if 0 <= i < len(evidence_records)
                ],
                reason=c.reason,
            )
        )

    computation_check = None
    if (ck := parsed.computation_check) is not None:
        computation_check = ComputationCheck(
            kind="date" if ck.kind == "date" else "numeric",
            claimed_value=ck.claimed_value,
            extracted_values=[
                ComputationValue(
                    label=v.label,
                    value=v.value,
                    unit=v.unit,
                    source_evidence_id=evidence_id_at(v.source_evidence_index),
                )
                for v in ck.extracted_values
            ],
            formula=ck.formula,
            computed_value=ck.computed_value,
            tolerance=ck.tolerance,
            judgment=ck.judgment,
            rationale=ck.rationale,
        )

    reasoning_chain: list[VerificationStep] = []
    for rs in parsed.reasoning_chain:
        reasoning_chain.append(VerificationStep(
            action=rs.action,
            observation=rs.observation,
            reasoning=rs.reasoning,
        ))

    corrected = None
    if parsed.correct_information is not None:
        ci = parsed.correct_information
        corrected = CorrectedInfo(
            value=ci.value,
            source=ci.source,
            url=ci.url,
            retrieved_date=ci.retrieved_date,
        )

    verdict = parsed.verdict
    confidence = parsed.confidence
    summary = parsed.summary
    why_wrong = parsed.why_wrong

    # Cross-verification floor: a substantive verdict (anything other than
    # "uncertain") must rest on >=2 independent sources. With fewer, we cannot
    # claim to have cross-verified — downgrade to uncertain and drop any
    # asserted "correct answer". Already-uncertain verdicts are left as-is.
    if verdict != FindingVerdict.UNCERTAIN and len(evidence_records) < 2:
        verdict = FindingVerdict.UNCERTAIN
        confidence = min(confidence, 0.5)
        corrected = None
        why_wrong = None
        summary = (
            summary
            + "  [Downgraded to uncertain: fewer than 2 independent sources "
            "were available to cross-verify.]"
        )

    finding = Finding(
        id=new_id("f"),
        claim_id=claim.id,
        agent=Agent.VERIFIER,
        verdict=verdict,
        severity=_UNIFIED_SEVERITY.get(verdict, Severity.MINOR),
        confidence=confidence,
        summary=summary,
        why_wrong=why_wrong,
        correct_information=corrected,
        reasoning_chain=reasoning_chain,
        evidence_quality=evidence_quality,
        coverage=coverage,
        computation_check=computation_check,
        evidence_ids=evidence_ids,
        reasoning_trace_id=trace.id,
    )
    return finding, evidence_records
