"""Redis Pub/Sub backed TraceBus.

Used when multiple API instances need to see the same job's events. The
single-instance demo uses InProcessBus instead; this class is selected only
when `Settings.redis_url` is set.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from redis.asyncio import Redis

from argus.trace_bus.base import TraceEvent

_HISTORY_KEY = "argus:trace:history:{job_id}"
_CHANNEL = "argus:trace:channel:{job_id}"


class _Subscription:
    def __init__(
        self,
        *,
        history: list[TraceEvent],
        live_q: asyncio.Queue[TraceEvent | None],
    ) -> None:
        self._history = history
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


class RedisPubSubBus:
    def __init__(self, url: str) -> None:
        self._redis: Redis = Redis.from_url(url, decode_responses=True)

    async def publish(self, event: TraceEvent) -> None:
        payload = json.dumps(
            {
                "job_id": event.job_id,
                "sequence": event.sequence,
                "kind": event.kind,
                "payload": event.payload,
            }
        )
        await self._redis.rpush(_HISTORY_KEY.format(job_id=event.job_id), payload)  # type: ignore[misc]
        await self._redis.publish(_CHANNEL.format(job_id=event.job_id), payload)

    @asynccontextmanager
    async def subscribe(
        self, job_id: str, *, after: int = 0
    ) -> AsyncIterator[_Subscription]:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(_CHANNEL.format(job_id=job_id))

        # Snapshot history.
        raw_history = await self._redis.lrange(  # type: ignore[misc]
            _HISTORY_KEY.format(job_id=job_id), 0, -1
        )
        history = [_decode(h) for h in raw_history]
        history = [h for h in history if h.sequence > after]

        live_q: asyncio.Queue[TraceEvent | None] = asyncio.Queue()

        async def relay() -> None:
            try:
                async for msg in pubsub.listen():
                    if msg.get("type") != "message":
                        continue
                    data = msg.get("data")
                    if data is None:
                        continue
                    ev = _decode(data)
                    await live_q.put(ev)
                    if ev.kind in ("finished", "failed"):
                        await live_q.put(None)
                        return
            finally:
                await live_q.put(None)

        relay_task = asyncio.create_task(relay())
        try:
            yield _Subscription(history=history, live_q=live_q)
        finally:
            relay_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await relay_task
            await pubsub.unsubscribe(_CHANNEL.format(job_id=job_id))
            await pubsub.aclose()  # type: ignore[no-untyped-call]

    async def close(self) -> None:
        await self._redis.aclose()


def _decode(raw: str) -> TraceEvent:
    obj = json.loads(raw)
    return TraceEvent(
        job_id=obj["job_id"],
        sequence=obj["sequence"],
        kind=obj["kind"],
        payload=obj.get("payload") or {},
    )
