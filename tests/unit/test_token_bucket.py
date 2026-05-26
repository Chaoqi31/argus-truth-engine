"""TokenBucket: leaky-bucket rate limiter for outbound HTTP calls."""
import asyncio
import time

import pytest

from argus.engineering import TokenBucket


@pytest.mark.asyncio
async def test_immediate_acquire_when_full():
    bucket = TokenBucket(rate_per_s=10.0, capacity=5)
    t0 = time.monotonic()
    for _ in range(5):
        await bucket.acquire()
    elapsed = time.monotonic() - t0
    assert elapsed < 0.05, f"5 tokens from full bucket should be instant, got {elapsed}s"


@pytest.mark.asyncio
async def test_blocks_when_empty_then_refills():
    bucket = TokenBucket(rate_per_s=10.0, capacity=2)
    await bucket.acquire()
    await bucket.acquire()
    t0 = time.monotonic()
    await bucket.acquire()  # must wait ~100ms for 1 token to refill
    elapsed = time.monotonic() - t0
    assert 0.08 < elapsed < 0.25, f"expected ~0.1s wait, got {elapsed}s"


@pytest.mark.asyncio
async def test_concurrent_acquires_are_serialized():
    bucket = TokenBucket(rate_per_s=5.0, capacity=1)
    await bucket.acquire()  # drain
    t0 = time.monotonic()
    await asyncio.gather(*(bucket.acquire() for _ in range(3)))
    elapsed = time.monotonic() - t0
    # 3 tokens at 5/s after empty = ~0.6s
    assert 0.4 < elapsed < 0.9, f"expected ~0.6s, got {elapsed}s"
