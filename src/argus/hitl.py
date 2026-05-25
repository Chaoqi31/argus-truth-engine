"""Human-in-the-loop review gate for the Argus pipeline.

Blocks the pipeline between Phase A (planner/atomizer/checkworthiness) and
Phase B (specialist verification) until the user selects which claims to verify.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from argus.log import log


@dataclass
class _PendingReview:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    selected_ids: list[str] | None = None


class ReviewGate:
    def __init__(self) -> None:
        self._pending: dict[str, _PendingReview] = {}

    def prepare(self, job_id: str) -> None:
        self._pending[job_id] = _PendingReview()

    async def wait(self, job_id: str, *, timeout: float = 300.0) -> list[str] | None:
        pending = self._pending.get(job_id)
        if not pending:
            return None
        try:
            await asyncio.wait_for(pending.event.wait(), timeout=timeout)
        except TimeoutError:
            log.info("hitl.timeout", job_id=job_id, timeout_s=timeout)
            return None
        return pending.selected_ids

    def submit(self, job_id: str, selected_claim_ids: list[str]) -> bool:
        pending = self._pending.get(job_id)
        if not pending:
            return False
        pending.selected_ids = selected_claim_ids
        pending.event.set()
        log.info("hitl.submitted", job_id=job_id, n_selected=len(selected_claim_ids))
        return True

    def cleanup(self, job_id: str) -> None:
        self._pending.pop(job_id, None)
