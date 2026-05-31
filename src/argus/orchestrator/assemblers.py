"""Pure data transforms — MiroMind responses → domain Findings/Traces/Evidence.

These functions have NO I/O and no shared state. They are unit-testable in
isolation. Keep them that way: any function added here that imports a runtime
client or settings is a bug.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from argus.agents.base import StreamCollection
from argus.agents.consistency import ConsistencyOutput
from argus.models.domain import (
    Claim,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    ReasoningStep,
    ReasoningTrace,
    Severity,
    Step,
)
from argus.orchestrator.context import _CONTEXT_WINDOW_CHARS
from argus.pdf.parser import ParsedDoc, ParsedPage

_UNIFIED_SEVERITY: dict[FindingVerdict, Severity] = {
    FindingVerdict.FABRICATED: Severity.MAJOR,
    FindingVerdict.INACCURATE: Severity.MAJOR,
    FindingVerdict.OUTDATED: Severity.MAJOR,
    FindingVerdict.MISREPRESENTED: Severity.CRITICAL,
    FindingVerdict.STALE: Severity.MAJOR,
    FindingVerdict.SUPERSEDED: Severity.CRITICAL,
    FindingVerdict.PARTIAL_MATCH: Severity.MINOR,
    FindingVerdict.MISMATCH: Severity.MAJOR,
    FindingVerdict.OK: Severity.MINOR,
    FindingVerdict.UNCERTAIN: Severity.MINOR,
}


def _coerce_evidence_source(raw: str) -> EvidenceSource:
    """Map a free-form source_type string from MiroMind to the enum, fallback WEB_PAGE."""
    try:
        return EvidenceSource(raw)
    except ValueError:
        return EvidenceSource.WEB_PAGE


def _text_to_doc(text: str) -> ParsedDoc:
    """Wrap raw text in a ParsedDoc with a single synthetic page."""
    page = ParsedPage(page_number=1, text=text, start_offset=0)
    return ParsedDoc(source_path=Path("<text-input>"), pages=(page,), full_text=text)


def _surrounding_text(doc: ParsedDoc | None, claim: Claim) -> str:
    if doc is None:
        return ""
    page = next((p for p in doc.pages if p.page_number == claim.page), None)
    if page is None:
        return ""
    start = max(0, claim.span[0] - _CONTEXT_WINDOW_CHARS)
    end = min(len(page.text), claim.span[1] + _CONTEXT_WINDOW_CHARS)
    return page.text[start:end]


def _make_finding(
    *,
    job_id: str,
    claim: Claim,
    parsed: Any,
    trace: ReasoningTrace,
    agent_name: str,
    severity_map: dict[FindingVerdict, Severity],
) -> tuple[Finding, list[Evidence]]:
    evidence_records: list[Evidence] = []
    evidence_ids: list[str] = []
    for ev in parsed.evidence:
        e = Evidence(
            id=f"ev_{uuid4().hex[:12]}",
            source_type=ev.source_type,
            url=ev.url,
            citation=ev.url or f"{ev.source_type} query",
            snippet=ev.snippet,
            retrieved_by_step_id=trace.steps[-1].id if trace.steps else "n/a",
        )
        evidence_records.append(e)
        evidence_ids.append(e.id)

    # Extract reasoning chain from specialist output if present
    reasoning_chain: list[ReasoningStep] = []
    if hasattr(parsed, "reasoning_chain") and parsed.reasoning_chain:
        for rs in parsed.reasoning_chain:
            reasoning_chain.append(ReasoningStep(
                step=rs.step,
                content=rs.content,
                evidence_ref=rs.evidence_ref,
                confidence_delta=rs.confidence_delta,
            ))

    finding = Finding(
        id=f"f_{uuid4().hex[:12]}",
        job_id=job_id,
        claim_id=claim.id,
        agent=agent_name,
        verdict=parsed.verdict,
        severity=severity_map.get(parsed.verdict, Severity.MINOR),
        confidence=parsed.confidence,
        summary=parsed.summary,
        reasoning_chain=reasoning_chain,
        evidence_ids=evidence_ids,
        reasoning_trace_id=trace.id,
    )
    return finding, evidence_records


def _make_unified_finding(
    *,
    job_id: str,
    claim: Claim,
    parsed: Any,
    trace: ReasoningTrace,
) -> tuple[Finding, list[Evidence]]:
    from argus.models.domain import CorrectedInfo, VerificationStep

    evidence_records: list[Evidence] = []
    evidence_ids: list[str] = []
    for ev in parsed.evidence:
        coerced = _coerce_evidence_source(ev.source_type)
        e = Evidence(
            id=f"ev_{uuid4().hex[:12]}",
            source_type=coerced,
            url=ev.url,
            citation=ev.url or f"{coerced.value} query",
            snippet=ev.snippet,
            retrieved_by_step_id=trace.steps[-1].id if trace.steps else "n/a",
        )
        evidence_records.append(e)
        evidence_ids.append(e.id)

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
        id=f"f_{uuid4().hex[:12]}",
        job_id=job_id,
        claim_id=claim.id,
        agent="UnifiedVerifier",
        verdict=verdict,
        severity=_UNIFIED_SEVERITY.get(verdict, Severity.MINOR),
        confidence=confidence,
        summary=summary,
        why_wrong=why_wrong,
        correct_information=corrected,
        reasoning_chain=reasoning_chain,
        evidence_ids=evidence_ids,
        reasoning_trace_id=trace.id,
    )
    return finding, evidence_records


def _contradictions_to_findings(
    *, job_id: str, parsed: ConsistencyOutput, trace_id: str
) -> list[Finding]:
    out: list[Finding] = []
    for pair in parsed.contradictions:
        a_id = f"f_{uuid4().hex[:12]}"
        b_id = f"f_{uuid4().hex[:12]}"
        out.append(
            Finding(
                id=a_id,
                job_id=job_id,
                claim_id=pair.claim_a_id,
                agent="Consistency",
                verdict=FindingVerdict.CONTRADICTION,
                severity=pair.severity,
                confidence=pair.confidence,
                summary=pair.summary,
                evidence_ids=[],
                reasoning_trace_id=trace_id,
                related_finding_ids=[b_id],
            )
        )
        out.append(
            Finding(
                id=b_id,
                job_id=job_id,
                claim_id=pair.claim_b_id,
                agent="Consistency",
                verdict=FindingVerdict.CONTRADICTION,
                severity=pair.severity,
                confidence=pair.confidence,
                summary=pair.summary,
                evidence_ids=[],
                reasoning_trace_id=trace_id,
                related_finding_ids=[a_id],
            )
        )
    return out


_LOGICAL_FLAW_VERDICT: dict[str, FindingVerdict] = {
    "unsupported_inference": FindingVerdict.UNSUPPORTED_INFERENCE,
    "overreach": FindingVerdict.OVERREACH,
}


def _logical_flaws_to_findings(
    *, job_id: str, parsed: ConsistencyOutput, trace_id: str
) -> list[Finding]:
    """Turn each document-internal LogicalFlaw into a single Finding.

    `flaw.missing` (what the document needs for the claim to hold) is surfaced
    through ``why_wrong`` so the report/UI shows the gap. These findings carry
    no evidence and no confidence_breakdown — same shape as contradictions.
    """
    out: list[Finding] = []
    for flaw in parsed.logical_flaws:
        out.append(
            Finding(
                id=f"f_{uuid4().hex[:12]}",
                job_id=job_id,
                claim_id=flaw.claim_id,
                agent="Consistency",
                verdict=_LOGICAL_FLAW_VERDICT[flaw.type],
                severity=flaw.severity,
                confidence=flaw.confidence,
                summary=flaw.summary,
                why_wrong=flaw.missing,
                evidence_ids=[],
                reasoning_trace_id=trace_id,
                related_finding_ids=[],
            )
        )
    return out


def _build_trace(
    *, job_id: str, claim_id: str, agent: str, stream: StreamCollection
) -> ReasoningTrace:
    # Link steps into a sequential chain so the reasoning DAG renders connected
    # edges (the frontend only draws an edge when parent_step_id is set).
    # Sort by sequence first — stream.steps order is not guaranteed — then point
    # each step at its predecessor. Copy rather than mutate: the input steps may
    # be shared elsewhere.
    ordered = sorted(stream.steps, key=lambda s: s.sequence)
    linked: list[Step] = []
    for i, step in enumerate(ordered):
        parent_id = ordered[i - 1].id if i > 0 else None
        linked.append(step.model_copy(update={"parent_step_id": parent_id}))

    return ReasoningTrace(
        id=f"trace_{uuid4().hex[:12]}",
        job_id=job_id,
        claim_id=claim_id,
        agent=agent,
        miromind_response_id=stream.response_id,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        total_tokens=stream.total_tokens,
        reasoning_tokens=stream.reasoning_tokens,
        num_search_queries=stream.num_search_queries,
        steps=linked,
    )


def _step_payload(trace: ReasoningTrace, *, n_claims: int | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "trace_id": trace.id,
        "agent": trace.agent,
        "claim_id": trace.claim_id,
        "total_tokens": trace.total_tokens,
        "reasoning_tokens": trace.reasoning_tokens,
        "num_search_queries": trace.num_search_queries,
    }
    if n_claims is not None:
        payload["n_claims"] = n_claims
    return payload


def _finding_payload(finding: Finding) -> dict[str, Any]:
    from argus.models.domain import VerificationStep

    payload: dict[str, Any] = {
        "finding_id": finding.id,
        "claim_id": finding.claim_id,
        "agent": finding.agent,
        "verdict": finding.verdict.value,
        "severity": finding.severity.value,
        "summary": finding.summary,
    }
    if finding.why_wrong:
        payload["why_wrong"] = finding.why_wrong
    if finding.correct_information:
        ci = finding.correct_information
        payload["correct_information"] = {
            "value": ci.value,
            "source": ci.source,
            "url": ci.url,
            "retrieved_date": ci.retrieved_date,
        }
    if finding.reasoning_chain:
        chain: list[dict[str, Any]] = []
        for rs in finding.reasoning_chain:
            if isinstance(rs, VerificationStep):
                chain.append({
                    "action": rs.action,
                    "observation": rs.observation,
                    "reasoning": rs.reasoning,
                })
            else:
                chain.append({
                    "step": rs.step,
                    "content": rs.content,
                    "evidence_ref": rs.evidence_ref,
                    "confidence_delta": rs.confidence_delta,
                })
        payload["reasoning_chain"] = chain
    if finding.confidence_breakdown:
        cb = finding.confidence_breakdown
        payload["confidence_breakdown"] = {
            "source_agreement": cb.source_agreement,
            "source_authority": cb.source_authority,
            "evidence_freshness": cb.evidence_freshness,
            "reasoning": cb.reasoning,
        }
    return payload
