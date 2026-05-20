"""TraceBus protocol + TraceEvent dataclass."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class TraceEvent:
    """One event in a job's live trace.

    kind values used by Argus:
      * "started"  - job lifecycle begin
      * "step"     - a Step was recorded; payload mirrors Step's serialised form
      * "finding"  - a Finding emitted
      * "finished" - job lifecycle end (terminal — subscribers should close)
      * "failed"   - terminal failure event
    """

    job_id: str
    sequence: int
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)


class Subscription(Protocol):
    def iter_history(self) -> AsyncIterator[TraceEvent]: ...
    def iter_live(self) -> AsyncIterator[TraceEvent]: ...


class TraceBus(Protocol):
    async def publish(self, event: TraceEvent) -> None: ...
    def subscribe(
        self, job_id: str, *, after: int = 0
    ) -> AbstractAsyncContextManager[Subscription]: ...
