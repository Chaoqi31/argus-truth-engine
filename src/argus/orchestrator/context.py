"""Cross-cutting orchestrator state: shared context, stage state, publisher."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING, Any

from typing_extensions import TypedDict

if TYPE_CHECKING:
    from argus.cache.finding_cache import FindingCache

from argus.config import Settings
from argus.engineering import BoundedRunner, BudgetTracker
from argus.llm import Llm
from argus.log import log
from argus.models.domain import Claim, Evidence, Finding, ReasoningTrace, Stage
from argus.pdf.parser import ParsedDoc
from argus.trace_bus.base import TraceBus, TraceEvent

_CONTEXT_WINDOW_CHARS = 200


class _State(TypedDict, total=False):
    """What the pipeline stages pass along. See `pipeline._merge` for how a
    stage's returned update is folded in: findings and traces merge by id,
    evidences and stages append, every other key is replaced."""

    job_id: str
    pdf_path: Path
    text: str | None
    input_mode: str
    doc: ParsedDoc | None
    claims: list[Claim]
    filtered_claims: list[dict[str, str]]  # [{"claim_id","text","reason"}]
    findings: dict[str, Finding]
    traces: dict[str, ReasoningTrace]
    stages: list[Stage]
    evidences: list[Evidence]
    audit_report_md: str | None
    aborted: bool
    abort_reason: str


class _Ctx:
    def __init__(
        self,
        *,
        llm: Llm,
        settings: Settings,
        budget: BudgetTracker,
        runners: dict[str, BoundedRunner],
        job_id: str,
        publisher: _Publisher,
        content_domain: str = "general",
        cache: FindingCache | None = None,
    ) -> None:
        self.llm = llm
        self.settings = settings
        self.budget = budget
        self.runners = runners
        self.job_id = job_id
        self.publisher = publisher
        self.content_domain = content_domain
        self.cache = cache


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

    async def stage(
        self,
        *,
        status: str,
        key: str,
        name: str,
        engine: str,
        summary: str = "",
        metrics: dict[str, int] | None = None,
    ) -> None:
        await self.publish(
            "stage",
            {
                "status": status,
                "key": key,
                "name": name,
                "engine": engine,
                "summary": summary,
                "metrics": metrics or {},
            },
        )

    async def finish(self, stage: Stage) -> Stage:
        """Publish a finished stage and return it for the job's stage list, so
        the live event and the stored record are the same value."""
        await self.stage(
            status="finished",
            key=stage.key,
            name=stage.name,
            engine=stage.engine,
            summary=stage.summary,
            metrics=stage.metrics,
        )
        return stage

    async def claim(
        self,
        *,
        status: str,
        claim: Claim,
        agent: str,
        index: int,
        total: int,
        verdict: str | None = None,
        severity: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "status": status,
            "claim_id": claim.id,
            "text": claim.text,
            "agent": agent,
            "index": index,
            "total": total,
        }
        if verdict is not None:
            payload["verdict"] = verdict
        if severity is not None:
            payload["severity"] = severity
        await self.publish("claim", payload)

    async def heartbeat(
        self,
        *,
        stage: str,
        agent: str,
        claim_id: str | None,
        elapsed_s: float,
        message: str,
    ) -> None:
        await self.publish(
            "heartbeat",
            {
                "stage": stage,
                "agent": agent,
                "claim_id": claim_id,
                "elapsed_s": round(elapsed_s, 3),
                "message": message,
            },
        )
