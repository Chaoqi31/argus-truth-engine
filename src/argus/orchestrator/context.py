"""Cross-cutting orchestrator state: shared context, state graph, publisher, charging."""
from __future__ import annotations

import asyncio
import operator
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any

from typing_extensions import TypedDict

if TYPE_CHECKING:
    from argus.cache.finding_cache import FindingCache

from argus.agents.base import AgentResult, StreamCollection
from argus.config import Settings
from argus.engineering import (
    BoundedRunner,
    BudgetTracker,
    cost_for_usage,
)
from argus.llm.cheap_client import CheapLLMClient
from argus.log import log
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, Evidence, Finding, ReasoningTrace
from argus.models.miromind import Usage
from argus.pdf.parser import ParsedDoc
from argus.trace_bus.base import TraceBus, TraceEvent

_CONTEXT_WINDOW_CHARS = 200


def _dict_merge(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    return {**a, **b}


class _State(TypedDict, total=False):
    job_id: str
    pdf_path: Path
    text: str | None
    input_mode: str
    doc: ParsedDoc | None
    claims: list[Claim]
    # Phase A outputs — preserved for UI display
    original_claims: list[Claim]
    filtered_claims: list[dict[str, str]]  # [{"claim_id","text","reason"}]
    findings: Annotated[list[Finding], operator.add]
    traces: Annotated[dict[str, ReasoningTrace], _dict_merge]
    evidences: Annotated[list[Evidence], operator.add]
    audit_report_md: str | None
    aborted: bool
    abort_reason: str


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
        cheap_client: CheapLLMClient | None = None,
        content_domain: str = "general",
        cache: FindingCache | None = None,
    ) -> None:
        self.client = client
        self.settings = settings
        self.budget = budget
        self.runners = runners
        self.job_id = job_id
        self.publisher = publisher
        self.cheap_client = cheap_client
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


def _charge(ctx: _Ctx, stream: StreamCollection) -> None:
    """Record cost into the budget tracker; raises BudgetExceeded on breach.

    Uses the real input/output token split captured from the MiroMind
    response. Treating the full total as output (a previous fallback) caused
    the budget tracker to overestimate spend by ~5-6x, which aborted audits
    well before MiroMind's actual billing hit the cap.
    """
    # Some streams (e.g. mocked tests) only set total_tokens. If we don't
    # have a split, fall back to charging total as output — still better
    # than crashing.
    if stream.input_tokens or stream.output_tokens:
        input_tokens = stream.input_tokens
        output_tokens = stream.output_tokens
    else:
        input_tokens = 0
        output_tokens = stream.total_tokens
    usage = Usage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=stream.total_tokens,
        reasoning_tokens=stream.reasoning_tokens,
        num_search_queries=stream.num_search_queries,
    )
    cost = cost_for_usage(
        usage, model=ctx.settings.miromind_model, web_searches=stream.num_search_queries
    )
    ctx.budget.charge(cost)


def _charge_result(ctx: _Ctx, result: AgentResult[Any]) -> None:
    for stream in result.streams:
        _charge(ctx, stream)
