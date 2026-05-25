"""Tests for cross-cutting engineering controls."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest

from argus.engineering import (
    BoundedRunner,
    BudgetExceeded,
    BudgetTracker,
    cost_for_usage,
    make_idempotency_key,
    retry_on_transient,
)
from argus.models.miromind import Usage

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


def test_budget_tracker_accumulates_and_reports_remaining() -> None:
    b = BudgetTracker(max_usd=1.00)
    b.charge(0.30)
    b.charge(0.40)
    assert b.spent_usd == pytest.approx(0.70)
    assert b.remaining_usd == pytest.approx(0.30)


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


# --- cost_for_usage -------------------------------------------------------


def test_cost_for_usage_flagship_promo_default() -> None:
    """Default model + promo applied (25% off): 1M in + 1M out + 1 search."""
    usage = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    cost = cost_for_usage(usage, model="mirothinker-1-7-deepresearch", web_searches=1)
    # 1M * $3 + 1M * $18.75 + 1 * $0.05 = 21.80
    assert cost == pytest.approx(21.80)


def test_cost_for_usage_mini_promo() -> None:
    usage = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    cost = cost_for_usage(usage, model="mirothinker-1-7-deepresearch-mini")
    # 1M * $0.9375 + 1M * $7.5 = 8.4375
    assert cost == pytest.approx(8.4375, rel=1e-3)


def test_cost_for_usage_zero_when_empty() -> None:
    assert cost_for_usage(Usage(), model="mirothinker-1-7-deepresearch") == 0.0


# --- make_idempotency_key -------------------------------------------------


def test_idempotency_key_is_deterministic_and_short() -> None:
    a = make_idempotency_key("job_abc", "CitationVerifier", "c1")
    b = make_idempotency_key("job_abc", "CitationVerifier", "c1")
    c = make_idempotency_key("job_abc", "CitationVerifier", "c2")
    assert a == b
    assert a != c
    assert len(a) == 16


# --- retry_on_transient ---------------------------------------------------


async def test_retry_retries_on_429_then_succeeds() -> None:
    calls = AsyncMock()

    @retry_on_transient(attempts=3, base_delay=0.01)
    async def flaky() -> str:
        calls()
        if calls.call_count < 3:
            req = httpx.Request("POST", "https://example.com")
            resp = httpx.Response(429, request=req)
            raise httpx.HTTPStatusError("429", request=req, response=resp)
        return "ok"

    result = await flaky()
    assert result == "ok"
    assert calls.call_count == 3


async def test_retry_does_not_retry_on_400() -> None:
    @retry_on_transient(attempts=3, base_delay=0.01)
    async def bad_request() -> str:
        req = httpx.Request("POST", "https://example.com")
        resp = httpx.Response(400, request=req)
        raise httpx.HTTPStatusError("400", request=req, response=resp)

    with pytest.raises(httpx.HTTPStatusError):
        await bad_request()


async def test_retry_gives_up_after_attempts_exhausted() -> None:
    @retry_on_transient(attempts=2, base_delay=0.01)
    async def always_500() -> str:
        req = httpx.Request("POST", "https://example.com")
        resp = httpx.Response(500, request=req)
        raise httpx.HTTPStatusError("500", request=req, response=resp)

    with pytest.raises(httpx.HTTPStatusError):
        await always_500()
