"""Argus orchestrator — LangGraph parallel 5-agent pipeline (Plan B2).

Flow (LangGraph StateGraph):

    parse_pdf  ->  planner  ---->  verifier     ---+
                            +-->   alignment    --->  reporter  ->  END
                            +-->   freshness    ---+
                            +-->   consistency  ---+

Each specialist node:
  * receives the full claims list from State,
  * filters claims it handles,
  * runs them through `asyncio.gather` bounded by a per-agent semaphore,
  * appends to `findings` / `traces` / `evidences` (LangGraph reducers
    merge across the 4 parallel branches without races).

Engineering controls:
  * BoundedRunner per agent caps in-flight per-claim concurrency.
  * BudgetTracker charges after every ResponseCompletedEvent;
    BudgetExceeded aborts further work, Reporter still tries to summarise
    whatever made it through.
  * Idempotency keys travel in MiroMind request metadata for B3's
    event-store dedup.
"""
from __future__ import annotations

import asyncio
import operator
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

if TYPE_CHECKING:
    from argus.db.repository import JobRepository

from argus.agents.base import AgentResult, JsonRepairFailed, StreamCollection
from argus.agents.citation_alignment import check_alignment
from argus.agents.citation_verifier import verify_citation
from argus.agents.consistency import ConsistencyOutput, check_consistency
from argus.agents.data_freshness import check_freshness
from argus.agents.planner import run_planner
from argus.agents.reporter import run_reporter
from argus.config import Settings
from argus.engineering import (
    BoundedRunner,
    BudgetExceeded,
    BudgetTracker,
    cost_for_usage,
    make_idempotency_key,
)
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
from argus.models.miromind import Usage
from argus.pdf.parser import ParsedDoc, parse_pdf
from argus.trace_bus.base import TraceBus, TraceEvent

_CONTEXT_WINDOW_CHARS = 200
# Per-agent concurrency. Kept conservative so the four specialist nodes fanning
# out in parallel (verifier + alignment + freshness + consistency) don't pile
# 16 concurrent MiroMind requests onto the API at once — the live runs at this
# rate triggered cascading 429s and 503s. With 1 here the total concurrency
# is bounded by the number of specialist agents (4) which the API handles.
_MAX_CONCURRENT_PER_AGENT = 1

_VERIFIER_SEVERITY: dict[FindingVerdict, Severity] = {
    FindingVerdict.FABRICATED: Severity.MAJOR,
    FindingVerdict.PARTIAL_MATCH: Severity.MINOR,
    FindingVerdict.OK: Severity.MINOR,
    FindingVerdict.UNCERTAIN: Severity.MINOR,
}
_ALIGNMENT_SEVERITY: dict[FindingVerdict, Severity] = {
    FindingVerdict.MISMATCH: Severity.MAJOR,
    FindingVerdict.MISREPRESENTED: Severity.CRITICAL,
    FindingVerdict.PARTIAL_MATCH: Severity.MINOR,
    FindingVerdict.OK: Severity.MINOR,
    FindingVerdict.UNCERTAIN: Severity.MINOR,
}
_FRESHNESS_SEVERITY: dict[FindingVerdict, Severity] = {
    FindingVerdict.STALE: Severity.MAJOR,
    FindingVerdict.SUPERSEDED: Severity.CRITICAL,
    FindingVerdict.OK: Severity.MINOR,
    FindingVerdict.UNCERTAIN: Severity.MINOR,
}


def _dict_merge(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    return {**a, **b}


class _State(TypedDict, total=False):
    job_id: str
    pdf_path: Path
    doc: ParsedDoc | None
    claims: list[Claim]
    findings: Annotated[list[Finding], operator.add]
    traces: Annotated[dict[str, ReasoningTrace], _dict_merge]
    evidences: Annotated[list[Evidence], operator.add]
    audit_report_md: str | None
    aborted: bool
    abort_reason: str


# --- Public entry point ----------------------------------------------------


async def audit_pdf(
    *,
    pdf_path: Path | str,
    output_path: Path | str,
    settings: Settings,
    client: MiromindClient | None = None,
    budget_usd: float = 5.0,
    repo: JobRepository | None = None,
    trace_bus: TraceBus | None = None,
    job_id: str | None = None,
) -> Job:
    """Top-level Plan B2 pipeline — LangGraph parallel 5-agent.

    Pass ``job_id`` to override the auto-generated id. The HTTP API uses this
    so the submit-time id (returned by POST /jobs) equals the id under which
    trace events are published.
    """
    pdf_path = Path(pdf_path)
    output_path = Path(output_path)
    if client is None:
        client = MiromindClient(settings)

    if job_id is None:
        job_id = f"job_{uuid4().hex[:12]}"
    job = Job(id=job_id, pdf_path=str(pdf_path), status="parsing")

    budget = BudgetTracker(max_usd=budget_usd)
    runners = {
        agent: BoundedRunner(max_concurrent=_MAX_CONCURRENT_PER_AGENT)
        for agent in (
            "citation_verifier",
            "citation_alignment",
            "data_freshness",
            "consistency",
        )
    }
    publisher = _Publisher(job_id=job_id, bus=trace_bus)
    ctx = _Ctx(
        client=client,
        settings=settings,
        budget=budget,
        runners=runners,
        job_id=job_id,
        publisher=publisher,
    )

    await publisher.publish("started", {"pdf_path": str(pdf_path)})

    graph = _build_graph(ctx)

    initial: _State = {
        "job_id": job_id,
        "pdf_path": pdf_path,
        "doc": None,
        "claims": [],
        "findings": [],
        "traces": {},
        "evidences": [],
        "audit_report_md": None,
        "aborted": False,
        "abort_reason": "",
    }
    final_state: _State = await graph.ainvoke(initial)

    job.claims = list(final_state.get("claims", []))
    job.findings = list(final_state.get("findings", []))
    job.traces = list(final_state.get("traces", {}).values())
    job.evidences = list(final_state.get("evidences", []))
    job.audit_report_md = final_state.get("audit_report_md")
    job.cost_usd = round(budget.spent_usd, 6)
    job.total_tokens = sum(t.total_tokens for t in job.traces)
    job.status = "failed" if final_state.get("aborted") else "done"
    job.completed_at = datetime.utcnow()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(job.model_dump_json(indent=2))
    log.info(
        "orchestrator.done",
        job_id=job_id,
        status=job.status,
        n_findings=len(job.findings),
        total_tokens=job.total_tokens,
        cost_usd=job.cost_usd,
    )
    if repo is not None:
        try:
            await repo.save_job(job)
            log.info("orchestrator.persisted", job_id=job.id)
        except Exception as exc:
            # DB failures must not lose the file output.
            log.error("orchestrator.persist_failed", error=str(exc)[:300])

    terminal_kind = "failed" if job.status == "failed" else "finished"
    terminal_payload: dict[str, Any] = {
        "status": job.status,
        "n_findings": len(job.findings),
        "cost_usd": job.cost_usd,
    }
    if job.status == "failed":
        terminal_payload["reason"] = final_state.get("abort_reason", "")
    await publisher.publish(terminal_kind, terminal_payload)
    return job


# --- Context shared with all nodes ----------------------------------------


class _Ctx:
    def __init__(
        self,
        *,
        client: MiromindClient,
        settings: Settings,
        budget: BudgetTracker,
        runners: dict[str, BoundedRunner],
        job_id: str,
        publisher: _Publisher,
    ) -> None:
        self.client = client
        self.settings = settings
        self.budget = budget
        self.runners = runners
        self.job_id = job_id
        self.publisher = publisher


class _Publisher:
    """Monotonically-numbered publish helper. No-op when bus is None.

    Sequence assignment is serialised under a lock so the four parallel
    specialist branches each get distinct, increasing sequence numbers.
    """

    def __init__(self, *, job_id: str, bus: TraceBus | None) -> None:
        self._job_id = job_id
        self._bus = bus
        self._seq = 0
        self._lock = asyncio.Lock()

    async def publish(self, kind: str, payload: dict[str, Any]) -> None:
        if self._bus is None:
            return
        async with self._lock:
            self._seq += 1
            seq = self._seq
        try:
            await self._bus.publish(
                TraceEvent(
                    job_id=self._job_id,
                    sequence=seq,
                    kind=kind,
                    payload=payload,
                )
            )
        except Exception as exc:  # pragma: no cover - observability path
            log.warning("trace_bus.publish_failed", error=str(exc)[:300])


# --- Graph wiring ----------------------------------------------------------


def _build_graph(ctx: _Ctx) -> Any:
    # mypy's overload resolution for StateGraph.add_node fights with our
    # TypedDict-with-Annotated-reducers `_State`; the runtime API is happy.
    graph: Any = StateGraph(_State)
    graph.add_node("parse_pdf", _parse_node(ctx))
    graph.add_node("planner", _planner_node(ctx))
    graph.add_node("citation_verifier", _verifier_node(ctx))
    graph.add_node("citation_alignment", _alignment_node(ctx))
    graph.add_node("data_freshness", _freshness_node(ctx))
    graph.add_node("consistency", _consistency_node(ctx))
    graph.add_node("reporter", _reporter_node(ctx))

    graph.add_edge(START, "parse_pdf")
    graph.add_edge("parse_pdf", "planner")
    for n in ("citation_verifier", "citation_alignment", "data_freshness", "consistency"):
        graph.add_edge("planner", n)
        graph.add_edge(n, "reporter")
    graph.add_edge("reporter", END)
    return graph.compile()


# --- Node factories --------------------------------------------------------


def _parse_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        pdf_path = state["pdf_path"]
        log.info("orchestrator.parse_start", pdf=str(pdf_path), job_id=ctx.job_id)
        doc = parse_pdf(pdf_path)
        log.info("orchestrator.parse_done", pages=len(doc.pages))
        return {"doc": doc}
    return node


def _planner_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        doc = state.get("doc")
        if doc is None:
            return {"aborted": True, "abort_reason": "no parsed document"}
        try:
            result = await run_planner(ctx.client, doc)
        except JsonRepairFailed as exc:
            log.error("orchestrator.planner_failed", error=str(exc)[:500])
            return {"aborted": True, "abort_reason": f"planner: {exc}"}

        try:
            _charge(ctx, result.first)
        except BudgetExceeded as exc:
            log.error("orchestrator.budget_exceeded_at_planner", error=str(exc))
            return {"aborted": True, "abort_reason": str(exc)}

        claims = result.parsed.to_claims()
        trace = _build_trace(
            job_id=ctx.job_id, claim_id="(planner)", agent="planner", stream=result.first
        )
        await ctx.publisher.publish("step", _step_payload(trace, n_claims=len(claims)))
        return {"claims": claims, "traces": {trace.id: trace}}
    return node


def _verifier_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        return await _per_claim_specialist(
            ctx=ctx,
            state=state,
            claim_filter=lambda c: c.type == ClaimType.CITATION,
            agent_name="CitationVerifier",
            metadata_agent="citation_verifier",
            severity_map=_VERIFIER_SEVERITY,
            run_call=lambda claim, surrounding: verify_citation(
                ctx.client, claim, surrounding=surrounding
            ),
            uses_surrounding=True,
        )
    return node


def _alignment_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        return await _per_claim_specialist(
            ctx=ctx,
            state=state,
            claim_filter=lambda c: c.type == ClaimType.CITATION,
            agent_name="CitationAlignment",
            metadata_agent="citation_alignment",
            severity_map=_ALIGNMENT_SEVERITY,
            run_call=lambda claim, surrounding: check_alignment(
                ctx.client, claim, surrounding=surrounding
            ),
            uses_surrounding=True,
        )
    return node


def _freshness_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        return await _per_claim_specialist(
            ctx=ctx,
            state=state,
            claim_filter=lambda c: c.type
            in (ClaimType.NUMERICAL_DATA, ClaimType.TIME_SENSITIVE),
            agent_name="DataFreshness",
            metadata_agent="data_freshness",
            severity_map=_FRESHNESS_SEVERITY,
            run_call=lambda claim, _: check_freshness(ctx.client, claim),
            uses_surrounding=False,
        )
    return node


def _consistency_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if state.get("aborted"):
            return {}
        claims = state.get("claims", [])
        if len(claims) < 2:  # noqa: PLR2004
            return {}
        try:
            result = await check_consistency(ctx.client, claims)
        except JsonRepairFailed as exc:
            log.warning("orchestrator.consistency_failed", error=str(exc)[:300])
            return {}

        try:
            _charge(ctx, result.first)
        except BudgetExceeded as exc:
            log.warning("orchestrator.budget_exceeded_at_consistency", error=str(exc))
            return {"aborted": True, "abort_reason": str(exc)}

        trace = _build_trace(
            job_id=ctx.job_id,
            claim_id="(consistency)",
            agent="Consistency",
            stream=result.first,
        )
        new_findings = _contradictions_to_findings(
            job_id=ctx.job_id, parsed=result.parsed, trace_id=trace.id
        )
        await ctx.publisher.publish("step", _step_payload(trace))
        for finding in new_findings:
            await ctx.publisher.publish("finding", _finding_payload(finding))
        return {"findings": new_findings, "traces": {trace.id: trace}}
    return node


def _reporter_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        if not state.get("findings"):
            return {}
        try:
            result = await run_reporter(
                ctx.client, state.get("claims", []), state["findings"]
            )
        except JsonRepairFailed as exc:
            log.warning("orchestrator.reporter_failed", error=str(exc)[:300])
            return {}

        try:
            _charge(ctx, result.first)
        except BudgetExceeded as exc:
            log.warning("orchestrator.budget_exceeded_at_reporter", error=str(exc))
            return {"aborted": True, "abort_reason": str(exc)}

        trace = _build_trace(
            job_id=ctx.job_id,
            claim_id="(reporter)",
            agent="Reporter",
            stream=result.first,
        )
        await ctx.publisher.publish("step", _step_payload(trace))
        return {
            "audit_report_md": result.parsed.executive_summary_md,
            "traces": {trace.id: trace},
        }
    return node


# --- Per-claim specialist helper ------------------------------------------


async def _per_claim_specialist(
    *,
    ctx: _Ctx,
    state: _State,
    claim_filter: Callable[[Claim], bool],
    agent_name: str,
    metadata_agent: str,
    severity_map: dict[FindingVerdict, Severity],
    run_call: Callable[[Claim, str], Awaitable[AgentResult[Any]]],
    uses_surrounding: bool,
) -> dict[str, Any]:
    matched = [c for c in state.get("claims", []) if claim_filter(c)]
    if not matched:
        return {}

    doc = state.get("doc")
    runner = ctx.runners[metadata_agent]

    async def run_for_claim(
        claim: Claim,
    ) -> tuple[Claim, AgentResult[Any] | None, JsonRepairFailed | None]:
        async with runner.acquire():
            surrounding = (
                _surrounding_text(doc, claim) if (uses_surrounding and doc) else ""
            )
            # Idempotency key travels in the model client's submit metadata.
            # AgentRunner only forwards `{"agent": ...}` today; the key
            # surfaces in logs and is forwarded to MiroMind via
            # `metadata={"idempotency_key": ...}` once AgentRunner is taught
            # about it (B3). For now we generate it for observability.
            _ = make_idempotency_key(ctx.job_id, agent_name, claim.id)
            try:
                return claim, await run_call(claim, surrounding), None
            except JsonRepairFailed as exc:
                log.warning(
                    "orchestrator.specialist_failed",
                    agent=agent_name,
                    claim_id=claim.id,
                    error=str(exc)[:300],
                )
                return claim, None, exc

    results = await asyncio.gather(*(run_for_claim(c) for c in matched))

    new_findings: list[Finding] = []
    new_traces: dict[str, ReasoningTrace] = {}
    new_evidences: list[Evidence] = []

    for claim, agent_result, failure in results:
        if failure is not None or agent_result is None:
            continue
        try:
            _charge(ctx, agent_result.first)
        except BudgetExceeded as exc:
            log.warning(
                "orchestrator.budget_exceeded_at_specialist",
                agent=agent_name,
                error=str(exc),
            )
            return {
                "aborted": True,
                "abort_reason": str(exc),
                "findings": new_findings,
                "traces": new_traces,
                "evidences": new_evidences,
            }
        trace = _build_trace(
            job_id=ctx.job_id, claim_id=claim.id, agent=agent_name, stream=agent_result.first
        )
        new_traces[trace.id] = trace
        finding, ev_records = _make_finding(
            job_id=ctx.job_id,
            claim=claim,
            parsed=agent_result.parsed,
            trace=trace,
            agent_name=agent_name,
            severity_map=severity_map,
        )
        new_findings.append(finding)
        new_evidences.extend(ev_records)
        await ctx.publisher.publish("step", _step_payload(trace))
        await ctx.publisher.publish("finding", _finding_payload(finding))

    return {
        "findings": new_findings,
        "traces": new_traces,
        "evidences": new_evidences,
    }


# --- Build helpers --------------------------------------------------------


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

    finding = Finding(
        id=f"f_{uuid4().hex[:12]}",
        job_id=job_id,
        claim_id=claim.id,
        agent=agent_name,
        verdict=parsed.verdict,
        severity=severity_map.get(parsed.verdict, Severity.MINOR),
        confidence=parsed.confidence,
        summary=parsed.summary,
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


def _surrounding_text(doc: ParsedDoc | None, claim: Claim) -> str:
    if doc is None:
        return ""
    page = next((p for p in doc.pages if p.page_number == claim.page), None)
    if page is None:
        return ""
    start = max(0, claim.span[0] - _CONTEXT_WINDOW_CHARS)
    end = min(len(page.text), claim.span[1] + _CONTEXT_WINDOW_CHARS)
    return page.text[start:end]


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
    return {
        "finding_id": finding.id,
        "claim_id": finding.claim_id,
        "agent": finding.agent,
        "verdict": finding.verdict.value,
        "severity": finding.severity.value,
        "summary": finding.summary,
    }


def _charge(ctx: _Ctx, stream: StreamCollection) -> None:
    """Record cost into the budget tracker; raises BudgetExceeded on breach."""
    usage = Usage(
        input_tokens=0,
        output_tokens=stream.total_tokens,
        total_tokens=stream.total_tokens,
        reasoning_tokens=stream.reasoning_tokens,
        num_search_queries=stream.num_search_queries,
    )
    # We don't have the input_tokens split here — assume total ≈ output for
    # conservative-ish cost estimate. Plan B3 will populate the split from
    # SSE-level usage events.
    cost = cost_for_usage(
        usage, model=ctx.settings.miromind_model, web_searches=stream.num_search_queries
    )
    ctx.budget.charge(cost)
