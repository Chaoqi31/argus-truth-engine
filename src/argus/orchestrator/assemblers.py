"""Pure data transforms — MiroMind responses → domain Findings/Traces/Evidence.

These functions have NO I/O and no shared state. They are unit-testable in
isolation. Keep them that way: any function added here that imports a runtime
client or settings is a bug.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from argus.agents.base import StreamCollection
from argus.agents.consistency import ConsistencyOutput
from argus.agents.unified_verifier import UnifiedVerifierOutput
from argus.models.domain import (
    Claim,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    ReasoningStep,
    ReasoningTrace,
    Severity,
)
from argus.pdf.parser import ParsedDoc, ParsedPage
from argus.orchestrator.context import _CONTEXT_WINDOW_CHARS

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
    from pathlib import Path
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

    finding = Finding(
        id=f"f_{uuid4().hex[:12]}",
        job_id=job_id,
        claim_id=claim.id,
        agent="UnifiedVerifier",
        verdict=parsed.verdict,
        severity=_UNIFIED_SEVERITY.get(parsed.verdict, Severity.MINOR),
        confidence=parsed.confidence,
        summary=parsed.summary,
        why_wrong=parsed.why_wrong,
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


def _build_trace(
    *, job_id: str, claim_id: str, agent: str, stream: StreamCollection
) -> ReasoningTrace:
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
        steps=list(stream.steps),
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
            "evidence_specificity": cb.evidence_specificity,
            "reasoning": cb.reasoning,
        }
    return payload
