"""Per-job engineering controls: concurrency, budget, idempotency.

Policy, not transport: nothing here does I/O. The pipeline bounds how many
claims run at once, charges each answer against the job's budget, and keys
each paid call so a retried submit is billed once.
"""
from __future__ import annotations

import asyncio
import hashlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

# --- Concurrency ----------------------------------------------------------


class BoundedRunner:
    """Simple async semaphore wrapper with an explicit context-manager API."""

    def __init__(self, *, max_concurrent: int) -> None:
        if max_concurrent < 1:
            raise ValueError("max_concurrent must be >= 1")
        self._sem = asyncio.Semaphore(max_concurrent)
        self.max_concurrent = max_concurrent

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        async with self._sem:
            yield


# --- Budget ---------------------------------------------------------------


class BudgetExceeded(RuntimeError):
    """Raised once spend exceeds the configured cap."""


@dataclass
class BudgetTracker:
    """Per-job cost ledger.

    `charge()` always records, then raises if the total now exceeds the cap.
    Recording-then-raising lets a caller know the post-breach total for
    logging and surface it to the user without losing data.
    """

    max_usd: float
    spent_usd: float = 0.0

    def charge(self, usd: float) -> None:
        self.spent_usd += usd
        if self.spent_usd > self.max_usd:
            raise BudgetExceeded(
                f"job budget exceeded: spent ${self.spent_usd:.2f} > "
                f"cap ${self.max_usd:.2f}"
            )


# --- Idempotency ----------------------------------------------------------


def make_idempotency_key(job_id: str, agent: str, claim_id: str) -> str:
    """Deterministic 16-char key for de-duping (job, agent, claim) work units."""
    raw = f"{job_id}:{agent}:{claim_id}".encode()
    return hashlib.sha1(raw, usedforsecurity=False).hexdigest()[:16]
