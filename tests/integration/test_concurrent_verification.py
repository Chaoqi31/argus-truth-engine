"""Verify that BoundedRunner actually parallelizes work up to its cap.

Uses a fake unit of work that sleeps 1 second per call. With concurrency=5,
5 calls should complete in roughly 1s, not 5s.
"""
import asyncio
import time

import pytest

from argus.engineering import BoundedRunner


@pytest.mark.asyncio
async def test_bounded_runner_actually_parallelizes():
    runner = BoundedRunner(max_concurrent=5)

    async def slow_unit() -> None:
        async with runner.acquire():
            await asyncio.sleep(1.0)

    t0 = time.monotonic()
    await asyncio.gather(*(slow_unit() for _ in range(5)))
    elapsed = time.monotonic() - t0
    assert elapsed < 1.5, f"5 parallel 1-sec units took {elapsed}s (expected ~1s)"


@pytest.mark.asyncio
async def test_bounded_runner_caps_concurrency_at_max():
    runner = BoundedRunner(max_concurrent=2)
    in_flight = 0
    peak = 0
    lock = asyncio.Lock()

    async def watched_unit() -> None:
        nonlocal in_flight, peak
        async with runner.acquire():
            async with lock:
                in_flight += 1
                peak = max(peak, in_flight)
            await asyncio.sleep(0.1)
            async with lock:
                in_flight -= 1

    await asyncio.gather(*(watched_unit() for _ in range(10)))
    assert peak == 2, f"BoundedRunner should cap at 2, saw {peak} in flight"
