"""`Run`: one execution of a job's pipeline, and the only writer of its job.

- `record(event)` applies the event to the job and emits it as a frame, with
  no await in between, so concurrent stages never interleave half-made
  changes and subscribers see frames in version order.
- `ask(task, prompt)` runs an LLM task as a recorded trace: opened, each step
  as it streams, then closed with what the task cost.
- `replay(trace)` records a finished trace reused from the verdict cache.

The budget: spend is the job's `cost_usd`, the sum over its traces, so a
resumed job counts what extraction spent. Once spend reaches the cap, `ask`
refuses new calls with `BudgetExceeded`. Calls already running finish and
are recorded: every cent spent shows in the job, and what it bought is kept.
"""
from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel

from argus.cache.finding_cache import FindingCache
from argus.config import Settings
from argus.llm import Answer, Llm, Task
from argus.models.domain import Agent, ReasoningTrace, Step, new_id
from argus.models.job import (
    Event,
    EventFrame,
    Failure,
    FailureKind,
    Job,
    StepRecorded,
    TraceClosed,
    TraceOpened,
)

Emit = Callable[[EventFrame], None]
"""Where frames go: the runner's subscribers, a test's list. Must not block."""


class AuditFailed(Exception):
    """The audit cannot go on; the job ends failed with `failure`."""

    def __init__(self, failure: Failure) -> None:
        super().__init__(failure.message)
        self.failure = failure


class BudgetExceeded(AuditFailed):
    pass


@dataclass(frozen=True)
class Traced[T: BaseModel]:
    answer: Answer[T]
    trace: ReasoningTrace  # as recorded in the job: closed, with its steps and usage


class Run:
    def __init__(
        self,
        job: Job,
        *,
        llm: Llm,
        cache: FindingCache | None,
        settings: Settings,
        budget_usd: float,
        emit: Emit,
    ) -> None:
        self.job = job
        self.llm = llm
        self.cache = cache
        self.settings = settings
        self.budget_usd = budget_usd
        self._emit = emit
        self.stopped_by_budget = False

    def record(self, event: Event) -> None:
        self.job.apply(event)
        self._emit(EventFrame(version=self.job.version, event=event))

    def budget_exceeded(self) -> BudgetExceeded:
        return BudgetExceeded(
            Failure(
                kind=FailureKind.BUDGET,
                message=(
                    f"job budget exceeded: spent ${self.job.cost_usd:.2f} "
                    f"of ${self.budget_usd:.2f}"
                ),
            )
        )

    async def ask[T: BaseModel](
        self, task: Task[T], prompt: str, *, claim_id: str | None = None
    ) -> Traced[T]:
        """Run ``task`` as one trace of this job. Raises `BudgetExceeded`,
        having started nothing, once the budget is spent."""
        if self.job.cost_usd >= self.budget_usd:
            self.stopped_by_budget = True
            raise self.budget_exceeded()
        trace_id = new_id("trace")
        self.record(
            TraceOpened(
                trace=ReasoningTrace(
                    id=trace_id,
                    agent=task.agent,
                    claim_id=claim_id,
                    engine=self.llm.engine(task),
                    started_at=datetime.utcnow(),
                )
            )
        )

        def on_step(step: Step) -> None:
            self.record(StepRecorded(trace_id=trace_id, step=step))

        answer = await self.llm.ask(
            task,
            prompt,
            on_step=on_step,
            idempotency_key=_idempotency_key(self.job.id, task.agent, claim_id),
        )
        self.record(
            TraceClosed(trace_id=trace_id, usage=answer.usage, completed_at=datetime.utcnow())
        )
        return Traced(answer, self.job.trace(trace_id))

    def replay(self, trace: ReasoningTrace) -> None:
        self.record(TraceOpened(trace=trace))


def _idempotency_key(job_id: str, agent: Agent, claim_id: str | None) -> str:
    """One key per task and claim in a job, so a retried submit is billed once."""
    raw = f"{job_id}:{agent}:{claim_id or ''}".encode()
    return hashlib.sha1(raw, usedforsecurity=False).hexdigest()[:16]
