"""Plan A sequential orchestrator.

Pipeline: parse_pdf -> planner -> for each citation claim -> verifier -> assemble Job.

This is intentionally simple. LangGraph + parallel specialists arrive in Plan B.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

from argus.agents.base import AgentResult, StreamCollection
from argus.agents.citation_verifier import (
    CitationVerifierOutput,
    verify_citation,
)
from argus.agents.planner import PlannerOutput, run_planner
from argus.config import Settings
from argus.log import log
from argus.miromind.client import MiromindClient
from argus.models.domain import (
    Claim,
    ClaimType,
    Evidence,
    Finding,
    FindingVerdict,
    Job,
    ReasoningTrace,
    Severity,
)
from argus.pdf.parser import ParsedDoc, parse_pdf

_SEVERITY_BY_VERDICT: dict[FindingVerdict, Severity] = {
    FindingVerdict.FABRICATED: Severity.MAJOR,
    FindingVerdict.PARTIAL_MATCH: Severity.MINOR,
    FindingVerdict.OK: Severity.MINOR,
    FindingVerdict.UNCERTAIN: Severity.MINOR,
}

_CONTEXT_WINDOW_CHARS = 200


async def audit_pdf(
    *,
    pdf_path: Path | str,
    output_path: Path | str,
    settings: Settings,
    client: MiromindClient | None = None,
) -> Job:
    """Top-level Plan A pipeline. Returns the assembled Job and writes findings.json."""
    pdf_path = Path(pdf_path)
    output_path = Path(output_path)
    if client is None:
        client = MiromindClient(settings)

    job_id = f"job_{uuid4().hex[:12]}"
    job = Job(id=job_id, pdf_path=str(pdf_path), status="parsing")

    log.info("orchestrator.parse_start", pdf=str(pdf_path), job_id=job_id)
    doc = parse_pdf(pdf_path)
    log.info("orchestrator.parse_done", pages=len(doc.pages))

    job.status = "planning"
    planner_result = await run_planner(client, doc)
    _ingest_planner(job, planner_result)

    job.status = "verifying"
    citations = [c for c in job.claims if c.type == ClaimType.CITATION]
    log.info("orchestrator.verify_start", n_citations=len(citations))
    for claim in citations:
        surrounding = _surrounding_text(doc, claim)
        result = await verify_citation(client, claim, surrounding=surrounding)
        _ingest_verifier(job, claim, result)

    job.status = "done"
    job.completed_at = datetime.utcnow()
    job.total_tokens = sum(t.total_tokens for t in job.traces)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(job.model_dump_json(indent=2))
    log.info(
        "orchestrator.done",
        job_id=job_id,
        n_findings=len(job.findings),
        total_tokens=job.total_tokens,
    )
    return job


def _surrounding_text(doc: ParsedDoc, claim: Claim) -> str:
    """Return up to ~400 chars of context around the claim's span on its page."""
    page = next((p for p in doc.pages if p.page_number == claim.page), None)
    if page is None:
        return ""
    start = max(0, claim.span[0] - _CONTEXT_WINDOW_CHARS)
    end = min(len(page.text), claim.span[1] + _CONTEXT_WINDOW_CHARS)
    return page.text[start:end]


def _ingest_planner(job: Job, result: AgentResult[PlannerOutput]) -> None:
    job.claims.extend(result.parsed.claims)
    job.traces.append(
        _build_trace(
            job_id=job.id,
            claim_id="(planner)",
            agent="planner",
            stream=result.first,
        )
    )


def _ingest_verifier(
    job: Job, claim: Claim, result: AgentResult[CitationVerifierOutput]
) -> None:
    parsed = result.parsed
    trace = _build_trace(
        job_id=job.id, claim_id=claim.id, agent="CitationVerifier", stream=result.first
    )
    job.traces.append(trace)

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
        job.evidences.append(e)
        evidence_ids.append(e.id)

    job.findings.append(
        Finding(
            id=f"f_{uuid4().hex[:12]}",
            job_id=job.id,
            claim_id=claim.id,
            agent="CitationVerifier",
            verdict=parsed.verdict,
            severity=_SEVERITY_BY_VERDICT.get(parsed.verdict, Severity.MINOR),
            confidence=parsed.confidence,
            summary=parsed.summary,
            evidence_ids=evidence_ids,
            reasoning_trace_id=trace.id,
        )
    )


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
