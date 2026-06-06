"""InProcessBus — asyncio-only TraceBus for single-process deploys."""
from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from argus.trace_bus.base import TraceEvent


class _Subscription:
    def __init__(
        self,
        *,
        history: list[TraceEvent],
        live_q: asyncio.Queue[TraceEvent | None],
        after: int,
    ) -> None:
        self._history = [e for e in history if e.sequence > after]
        self._live_q = live_q

    async def iter_history(self) -> AsyncIterator[TraceEvent]:
        for e in self._history:
            yield e

    async def iter_live(self) -> AsyncIterator[TraceEvent]:
        while True:
            ev = await self._live_q.get()
            if ev is None:
                return
            yield ev


class InProcessBus:
    """asyncio.Queue + history buffer per job, multiple subscribers fan-out."""

    def __init__(
        self,
        *,
        max_history_events: int = 5000,
        history_ttl_s: float | None = 86400.0,
    ) -> None:
        self._history: dict[str, list[TraceEvent]] = defaultdict(list)
        self._subscribers: dict[str, list[asyncio.Queue[TraceEvent | None]]] = (
            defaultdict(list)
        )
        self._max_history_events = max_history_events
        self._history_ttl_s = history_ttl_s
        self._expiry_tasks: set[asyncio.Task[None]] = set()
        self._lock = asyncio.Lock()

    async def publish(self, event: TraceEvent) -> None:
        async with self._lock:
            history = self._history[event.job_id]
            history.append(event)
            if self._max_history_events > 0 and len(history) > self._max_history_events:
                del history[: len(history) - self._max_history_events]
            for q in list(self._subscribers[event.job_id]):
                await q.put(event)
            if event.kind in ("finished", "failed"):
                # Wake up live iterators so they can close cleanly.
                for q in list(self._subscribers[event.job_id]):
                    await q.put(None)
                if self._history_ttl_s is not None:
                    task = asyncio.create_task(self._expire_history(event.job_id))
                    self._expiry_tasks.add(task)
                    task.add_done_callback(self._expiry_tasks.discard)

    async def _expire_history(self, job_id: str) -> None:
        delay = max(0.0, self._history_ttl_s or 0.0)
        if delay:
            await asyncio.sleep(delay)
        async with self._lock:
            self._history.pop(job_id, None)

    @asynccontextmanager
    async def subscribe(
        self, job_id: str, *, after: int = 0
    ) -> AsyncIterator[_Subscription]:
        live_q: asyncio.Queue[TraceEvent | None] = asyncio.Queue()
        async with self._lock:
            history_snapshot = list(self._history.get(job_id, ()))
            self._subscribers[job_id].append(live_q)
        try:
            yield _Subscription(history=history_snapshot, live_q=live_q, after=after)
        finally:
            async with self._lock:
                if live_q in self._subscribers[job_id]:
                    self._subscribers[job_id].remove(live_q)
