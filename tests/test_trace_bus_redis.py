"""Integration-ish tests for RedisPubSubBus.

Skipped automatically if ARGUS_TEST_REDIS_URL is not set in env. Local dev:
    docker compose up -d redis
    ARGUS_TEST_REDIS_URL=redis://localhost:6390/0 uv run pytest tests/test_trace_bus_redis.py
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from argus.trace_bus.base import TraceEvent
from argus.trace_bus.redis_pubsub import RedisPubSubBus

REDIS_URL = os.environ.get("ARGUS_TEST_REDIS_URL")
pytestmark = pytest.mark.skipif(
    REDIS_URL is None, reason="ARGUS_TEST_REDIS_URL not set; Redis tests skipped."
)


async def test_redis_publish_subscribe_round_trip() -> None:
    bus = RedisPubSubBus(REDIS_URL or "redis://localhost:6390/0")
    job_id = f"j_test_{uuid.uuid4().hex[:8]}"

    async def produce() -> None:
        await asyncio.sleep(0.05)  # let subscriber be ready
        await bus.publish(TraceEvent(job_id=job_id, sequence=1, kind="step"))
        await bus.publish(TraceEvent(job_id=job_id, sequence=2, kind="finished"))

    received: list[int] = []
    async with bus.subscribe(job_id) as sub:
        task = asyncio.create_task(produce())
        async for ev in sub.iter_live():
            received.append(ev.sequence)
            if ev.kind == "finished":
                break
        await task

    assert received == [1, 2]
    await bus.close()
