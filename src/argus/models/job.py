"""The audit job: the aggregate, its status machine, its events, and the
frames that carry them to the web.

A job is the fold of its events. During a run the only way to change a `Job`
is `apply(event)`, which `argus.audit.Run.record` calls right before it sends
the same event to subscribers, so the live view and the stored job cannot
disagree. `version` counts the events applied; it is stored with the job, so
it keeps counting across the review pause and a restart.

    running --ReviewReady--> awaiting_review --ClaimsSelected--> running
    running --Finished--> done | failed
"""
from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import Field, computed_field, model_validator

from argus.models.domain import (
    Agent,
    BenchmarkSpec,
    Claim,
    ContentDomain,
    Engine,
    Evidence,
    Finding,
    Frozen,
    ReasoningTrace,
    Stage,
    StageFilteredClaim,
    StageKey,
    StageStatus,
    Step,
    Usage,
    _Base,
)

JobStatus = Literal["running", "awaiting_review", "done", "failed"]


class FailureKind(StrEnum):
    BUDGET = "budget"  # the job's spend cap was reached
    INTERRUPTED = "interrupted"  # the run was cut off: a restart or a cancel
    ERROR = "error"  # the input or a provider made the audit impossible


class Failure(Frozen):
    kind: FailureKind
    message: str


class IllegalTransition(RuntimeError):
    """An event that does not fit the job's state. A bug, never a user error."""


class NotAwaitingReview(ValueError):
    """A claim selection for a job that is not paused for review."""


class UnknownClaims(ValueError):
    """A claim selection naming claims that are not review candidates."""


# --- Events -------------------------------------------------------------------
# One change to a job each. `type` is the discriminator on the wire and in the
# web's generated union.


class StageStarted(Frozen):
    type: Literal["stage_started"] = "stage_started"
    key: StageKey
    engine: Engine


class StageFinished(Frozen):
    type: Literal["stage_finished"] = "stage_finished"
    key: StageKey
    summary: str
    metrics: dict[str, int] = Field(default_factory=dict)
    filtered_claims: tuple[StageFilteredClaim, ...] = ()


class ReviewReady(Frozen):
    """Extraction is done and these candidates wait for the reviewer."""

    type: Literal["review_ready"] = "review_ready"
    claims: tuple[Claim, ...]


class ClaimsSelected(Frozen):
    """The candidates the reviewer kept, in candidate order."""

    type: Literal["claims_selected"] = "claims_selected"
    claim_ids: tuple[str, ...]


class TraceOpened(Frozen):
    """An LLM task started, or a cached trace was reused whole."""

    type: Literal["trace_opened"] = "trace_opened"
    trace: ReasoningTrace


class StepRecorded(Frozen):
    type: Literal["step_recorded"] = "step_recorded"
    trace_id: str
    step: Step


class TraceClosed(Frozen):
    type: Literal["trace_closed"] = "trace_closed"
    trace_id: str
    usage: Usage
    completed_at: datetime


class FindingRecorded(Frozen):
    """A new finding, or a revision of one (same id), with the evidence it
    cites that the job does not have yet."""

    type: Literal["finding_recorded"] = "finding_recorded"
    finding: Finding
    evidences: tuple[Evidence, ...] = ()


class ReportWritten(Frozen):
    type: Literal["report_written"] = "report_written"
    markdown: str


class Finished(Frozen):
    """The run ended. Stages still running end as failed."""

    type: Literal["finished"] = "finished"
    status: Literal["done", "failed"]
    failure: Failure | None = None
    completed_at: datetime

    @model_validator(mode="after")
    def _failure_iff_failed(self) -> Finished:
        if (self.status == "failed") != (self.failure is not None):
            raise ValueError("a failed run carries its failure, a done one none")
        return self


Event = Annotated[
    StageStarted
    | StageFinished
    | ReviewReady
    | ClaimsSelected
    | TraceOpened
    | StepRecorded
    | TraceClosed
    | FindingRecorded
    | ReportWritten
    | Finished,
    Field(discriminator="type"),
]

_STAGE_ORDER = {key: i for i, key in enumerate(StageKey)}


class Job(_Base):
    """The audit aggregate. Stored whole as one document; see `apply` for how
    it changes during a run."""

    id: str
    scenario_label: str | None = None
    persona: str | None = None
    pdf_path: str = ""
    input_text: str | None = None
    input_mode: Literal["pdf", "text"] = "pdf"
    content_domain: ContentDomain = ContentDomain.GENERAL
    auto_review: bool = False
    status: JobStatus = "running"
    failure: Failure | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    version: int = 0
    audit_report_md: str | None = None

    claims: list[Claim] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    traces: list[ReasoningTrace] = Field(default_factory=list)
    evidences: list[Evidence] = Field(default_factory=list)
    stages: list[Stage] = Field(default_factory=list)
    # Demo-fixture-only ground truth; always None on live jobs. See BenchmarkSpec.
    benchmark: BenchmarkSpec | None = None

    # Derived, so they cannot drift from what they summarise. Sent to the web
    # and projected into list columns, never stored in the document.

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cost_usd(self) -> float:
        return round(sum(t.usage.cost_usd for t in self.traces), 6)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def total_tokens(self) -> int:
        return sum(t.usage.total_tokens for t in self.traces)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def claims_total(self) -> int:
        """Claims sent to verification: the reviewer's selection once made."""
        return len(self.claims)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def claims_audited(self) -> int:
        """Claims with a verifier verdict, failed ones included. Fewer than
        `claims_total` means the audit stopped part-way."""
        return sum(1 for f in self.findings if f.agent == Agent.VERIFIER)

    def document_json(self) -> str:
        """The stored form: everything but the derived fields."""
        return self.model_dump_json(exclude_computed_fields=True)

    def trace(self, trace_id: str) -> ReasoningTrace:
        return self.traces[self._trace_index(trace_id)]

    def check_selection(self, claim_ids: Collection[str]) -> None:
        """Raise unless the reviewer may select ``claim_ids`` now."""
        if self.status != "awaiting_review":
            raise NotAwaitingReview(f"job {self.id} is {self.status}, not awaiting review")
        unknown = set(claim_ids) - {c.id for c in self.claims}
        if unknown:
            raise UnknownClaims(f"not review candidates: {', '.join(sorted(unknown))}")

    def apply(self, event: Event) -> None:  # noqa: PLR0912 - a branch per event type
        """Apply one event and count it in `version`. An event that does not
        fit the job's state raises and changes nothing."""
        if isinstance(event, ClaimsSelected):
            self.check_selection(event.claim_ids)
            selected = set(event.claim_ids)
            self.claims = [c for c in self.claims if c.id in selected]
            self.status = "running"
        elif self.status != "running":
            raise IllegalTransition(f"{event.type} on a job that is {self.status}")
        elif isinstance(event, StageStarted):
            if any(s.key == event.key for s in self.stages):
                raise IllegalTransition(f"stage {event.key} started twice")
            self.stages.append(Stage(key=event.key, engine=event.engine))
            self.stages.sort(key=lambda s: _STAGE_ORDER[s.key])
        elif isinstance(event, StageFinished):
            i = next((i for i, s in enumerate(self.stages) if s.key == event.key), None)
            if i is None or self.stages[i].status is not StageStatus.RUNNING:
                raise IllegalTransition(f"stage {event.key} is not running")
            self.stages[i] = self.stages[i].model_copy(
                update={
                    "status": StageStatus.DONE,
                    "summary": event.summary,
                    "metrics": event.metrics,
                    "filtered_claims": event.filtered_claims,
                }
            )
        elif isinstance(event, ReviewReady):
            self.claims = list(event.claims)
            self.status = "awaiting_review"
        elif isinstance(event, TraceOpened):
            if any(t.id == event.trace.id for t in self.traces):
                raise IllegalTransition(f"trace {event.trace.id} opened twice")
            self.traces.append(event.trace)
        elif isinstance(event, StepRecorded):
            i = self._open_trace_index(event.trace_id)
            trace = self.traces[i]
            self.traces[i] = trace.model_copy(update={"steps": (*trace.steps, event.step)})
        elif isinstance(event, TraceClosed):
            i = self._open_trace_index(event.trace_id)
            self.traces[i] = self.traces[i].model_copy(
                update={"usage": event.usage, "completed_at": event.completed_at}
            )
        elif isinstance(event, FindingRecorded):
            known = {e.id for e in self.evidences}
            self.evidences.extend(e for e in event.evidences if e.id not in known)
            i = next((i for i, f in enumerate(self.findings) if f.id == event.finding.id), None)
            if i is None:
                self.findings.append(event.finding)
            else:
                self.findings[i] = event.finding
        elif isinstance(event, ReportWritten):
            self.audit_report_md = event.markdown
        else:
            self.status = event.status
            self.failure = event.failure
            self.completed_at = event.completed_at
            self.stages = [
                s.model_copy(update={"status": StageStatus.FAILED})
                if s.status is StageStatus.RUNNING
                else s
                for s in self.stages
            ]
        self.version += 1

    def _trace_index(self, trace_id: str) -> int:
        i = next((i for i, t in enumerate(self.traces) if t.id == trace_id), None)
        if i is None:
            raise IllegalTransition(f"no trace {trace_id}")
        return i

    def _open_trace_index(self, trace_id: str) -> int:
        i = self._trace_index(trace_id)
        if self.traces[i].completed_at is not None:
            raise IllegalTransition(f"trace {trace_id} is closed")
        return i


# --- Frames -------------------------------------------------------------------
# What the live WebSocket sends: the whole job, then each event applied to it.


class SnapshotFrame(_Base):
    type: Literal["snapshot"] = "snapshot"
    job: Job


class EventFrame(Frozen):
    """One applied event; `version` is the job's version after it."""

    type: Literal["event"] = "event"
    version: int
    event: Event


Frame = Annotated[SnapshotFrame | EventFrame, Field(discriminator="type")]
