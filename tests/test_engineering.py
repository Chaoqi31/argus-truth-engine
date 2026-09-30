"""Tests for cross-cutting engineering controls."""
from __future__ import annotations

import asyncio

import pytest

from argus.engineering import (
    BoundedRunner,
    BudgetExceeded,
    BudgetTracker,
    make_idempotency_key,
)

# --- BoundedRunner --------------------------------------------------------


async def test_bounded_runner_caps_concurrency() -> None:
    runner = BoundedRunner(max_concurrent=2)
    active = 0
    peak = 0
    lock = asyncio.Lock()

    async def task(i: int) -> int:
        nonlocal active, peak
        async with runner.acquire():
            async with lock:
                active += 1
                peak = max(peak, active)
            await asyncio.sleep(0.01)
            async with lock:
                active -= 1
        return i

    results = await asyncio.gather(*[task(i) for i in range(8)])
    assert results == list(range(8))
    assert peak <= 2


# --- BudgetTracker --------------------------------------------------------


def test_budget_tracker_accumulates() -> None:
    b = BudgetTracker(max_usd=1.00)
    b.charge(0.30)
    b.charge(0.40)
    assert b.spent_usd == pytest.approx(0.70)


def test_budget_tracker_raises_when_exceeded() -> None:
    b = BudgetTracker(max_usd=0.50)
    b.charge(0.40)
    with pytest.raises(BudgetExceeded) as exc_info:
        b.charge(0.20)
    assert "0.60" in str(exc_info.value)  # spent total surfaced
    assert "0.50" in str(exc_info.value)  # cap surfaced


def test_budget_tracker_is_idempotent_after_breach() -> None:
    """Once breached, further charges still record but keep raising."""
    b = BudgetTracker(max_usd=0.10)
    with pytest.raises(BudgetExceeded):
        b.charge(0.20)
    with pytest.raises(BudgetExceeded):
        b.charge(0.05)
    assert b.spent_usd == pytest.approx(0.25)


# --- make_idempotency_key -------------------------------------------------


def test_idempotency_key_is_deterministic_and_short() -> None:
    a = make_idempotency_key("job_abc", "CitationVerifier", "c1")
    b = make_idempotency_key("job_abc", "CitationVerifier", "c1")
    c = make_idempotency_key("job_abc", "CitationVerifier", "c2")
    assert a == b
    assert a != c
    assert len(a) == 16
