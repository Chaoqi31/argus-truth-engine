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

    def __init__(self) -> None:
        self._history: dict[str, list[TraceEvent]] = defaultdict(list)
        self._subscribers: dict[str, list[asyncio.Queue[TraceEvent | None]]] = (
            defaultdict(list)
        )
        self._lock = asyncio.Lock()

    async def publish(self, event: TraceEvent) -> None:
        async with self._lock:
            self._history[event.job_id].append(event)
            for q in list(self._subscribers[event.job_id]):
                await q.put(event)
            if event.kind in ("finished", "failed"):
                # Wake up live iterators so they can close cleanly.
                for q in list(self._subscribers[event.job_id]):
                    await q.put(None)

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
