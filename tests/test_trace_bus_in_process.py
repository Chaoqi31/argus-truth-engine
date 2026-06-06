"""Tests for InProcessBus — subscribe/publish/replay."""
from __future__ import annotations

import asyncio

from argus.trace_bus.base import TraceEvent
from argus.trace_bus.in_process import InProcessBus


def _event(kind: str, sequence: int, payload: dict | None = None) -> TraceEvent:
    return TraceEvent(
        job_id="j1",
        sequence=sequence,
        kind=kind,
        payload=payload or {},
    )


async def test_publish_then_subscribe_replays_history() -> None:
    bus = InProcessBus()
    await bus.publish(_event("step", 1, {"summary": "thinking"}))
    await bus.publish(_event("step", 2, {"summary": "search"}))
    received: list[TraceEvent] = []
    async with bus.subscribe("j1") as sub:
        async for ev in sub.iter_history():
            received.append(ev)
    seqs = [e.sequence for e in received]
    assert seqs == [1, 2]


async def test_subscribe_receives_live_events() -> None:
    bus = InProcessBus()

    async def producer() -> None:
        await asyncio.sleep(0.01)
        await bus.publish(_event("step", 1))
        await bus.publish(_event("step", 2))
        await bus.publish(_event("finished", 3))

    received: list[TraceEvent] = []
    async with bus.subscribe("j1") as sub:
        task = asyncio.create_task(producer())
        async for ev in sub.iter_live():
            received.append(ev)
            if ev.kind == "finished":
                break
        await task

    assert [e.sequence for e in received] == [1, 2, 3]


async def test_subscribe_after_some_history_replays_then_streams() -> None:
    bus = InProcessBus()
    await bus.publish(_event("step", 1))
    await bus.publish(_event("step", 2))

    received: list[TraceEvent] = []

    async def consume() -> None:
        async with bus.subscribe("j1") as sub:
            async for ev in sub.iter_history():
                received.append(ev)
            async for ev in sub.iter_live():
                received.append(ev)
                if ev.sequence == 4:
                    break

    consumer = asyncio.create_task(consume())
    await asyncio.sleep(0.01)
    await bus.publish(_event("step", 3))
    await bus.publish(_event("step", 4))
    await consumer

    assert [e.sequence for e in received] == [1, 2, 3, 4]


async def test_resume_after_skips_already_seen() -> None:
    bus = InProcessBus()
    for i in range(1, 6):
        await bus.publish(_event("step", i))

    received: list[int] = []
    async with bus.subscribe("j1", after=3) as sub:
        async for ev in sub.iter_history():
            received.append(ev.sequence)
    assert received == [4, 5]


async def test_history_is_trimmed_to_max_events() -> None:
    bus = InProcessBus(max_history_events=2)
    for i in range(1, 6):
        await bus.publish(_event("step", i))

    received: list[int] = []
    async with bus.subscribe("j1") as sub:
        async for ev in sub.iter_history():
            received.append(ev.sequence)

    assert received == [4, 5]


async def test_terminal_history_expires_after_ttl() -> None:
    bus = InProcessBus(history_ttl_s=0.01)
    await bus.publish(_event("step", 1))
    await bus.publish(_event("finished", 2))
    await asyncio.sleep(0.03)

    received: list[int] = []
    async with bus.subscribe("j1") as sub:
        async for ev in sub.iter_history():
            received.append(ev.sequence)

    assert received == []
