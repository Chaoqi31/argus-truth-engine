"""Cross-cutting engineering controls — concurrency, budget, retry, idempotency.

This module is policy, not transport. It does no I/O of its own; callers
plug it into MiromindClient (retry) and the orchestrator (concurrency +
budget). Keeping these concerns separate from agent code lets us tune them
without touching prompts or business logic.
"""
from __future__ import annotations

import asyncio
import hashlib
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Final, TypeVar

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from argus.models.miromind import Usage

T = TypeVar("T")

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
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    def charge(self, usd: float) -> None:
        self.spent_usd += usd
        if self.spent_usd > self.max_usd:
            raise BudgetExceeded(
                f"job budget exceeded: spent ${self.spent_usd:.2f} > "
                f"cap ${self.max_usd:.2f}"
            )

    async def acharge(self, usd: float) -> None:
        async with self._lock:
            self.charge(usd)

    @property
    def remaining_usd(self) -> float:
        return self.max_usd - self.spent_usd


# --- Cost model -----------------------------------------------------------

# Per-1M-token list prices (USD). Promo is applied at call-time.
_LIST_PRICE: Final[dict[str, tuple[float, float]]] = {
    "mirothinker-1-7-deepresearch":      (4.00, 25.00),
    "mirothinker-1-7-deepresearch-mini": (1.25, 10.00),
}
_PROMO_FACTOR: Final[float] = 0.75       # 25% off, current MiroMind promo
_WEB_SEARCH_FEE_USD: Final[float] = 0.05


def _usage_field(usage: Usage, *names: str) -> int:
    """Read the first matching token-count field from a Usage block.

    The MiroMind SSE Usage model exposes prompt_tokens/completion_tokens,
    but callers (and the hosted API) sometimes send input_tokens/output_tokens
    via the model's ``extra="allow"`` policy. We probe both so the cost
    calculator stays robust to either spelling.
    """
    for name in names:
        value = getattr(usage, name, None)
        if value is None:
            extras = getattr(usage, "model_extra", None) or {}
            value = extras.get(name)
        if isinstance(value, int) and value:
            return value
    return 0


def cost_for_usage(
    usage: Usage,
    *,
    model: str,
    web_searches: int = 0,
    promo: float = _PROMO_FACTOR,
) -> float:
    """Convert a `Usage` block (+ web_search count) to USD."""
    in_per_m, out_per_m = _LIST_PRICE.get(
        model, _LIST_PRICE["mirothinker-1-7-deepresearch"]
    )
    input_tokens = _usage_field(usage, "input_tokens", "prompt_tokens")
    output_tokens = _usage_field(usage, "output_tokens", "completion_tokens")
    token_cost = (
        (input_tokens / 1_000_000) * in_per_m * promo
        + (output_tokens / 1_000_000) * out_per_m * promo
    )
    return float(token_cost + web_searches * _WEB_SEARCH_FEE_USD)


# --- Idempotency ----------------------------------------------------------


def make_idempotency_key(job_id: str, agent: str, claim_id: str) -> str:
    """Deterministic 16-char key for de-duping (job, agent, claim) work units."""
    raw = f"{job_id}:{agent}:{claim_id}".encode()
    return hashlib.sha1(raw, usedforsecurity=False).hexdigest()[:16]


# --- Rate limiting -------------------------------------------------------


class TokenBucket:
    """Process-wide async leaky-bucket rate limiter.

    Tokens refill continuously at ``rate_per_s``; capacity bounds burst size.
    ``acquire()`` blocks asynchronously until a token is available.

    Thread-safe within a single event loop. Do not share across loops.
    """

    def __init__(self, *, rate_per_s: float, capacity: int) -> None:
        if rate_per_s <= 0:
            raise ValueError("rate_per_s must be > 0")
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        self._rate = rate_per_s
        self._capacity = capacity
        self._tokens = float(capacity)
        self._last: float | None = None  # set on first acquire from the running loop
        self._lock = asyncio.Lock()

    async def acquire(self, tokens: int = 1) -> None:
        if tokens > self._capacity:
            raise ValueError(f"requested {tokens} tokens > capacity {self._capacity}")
        async with self._lock:
            while True:
                loop = asyncio.get_running_loop()
                now = loop.time()
                if self._last is None:
                    self._last = now
                elapsed = now - self._last
                self._tokens = min(self._capacity, self._tokens + elapsed * self._rate)
                self._last = now
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return
                wait_s = (tokens - self._tokens) / self._rate
                await asyncio.sleep(wait_s)


# --- Retry ----------------------------------------------------------------


_RETRY_STATUS_CODES: Final[frozenset[int]] = frozenset({408, 425, 429, 500, 502, 503, 504})


def _is_transient(exc: BaseException) -> bool:
    """Retry on connection errors and on responses with retry-eligible codes."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRY_STATUS_CODES
    return isinstance(exc, httpx.RequestError)


def retry_on_transient(
    *, attempts: int = 3, base_delay: float = 1.0
) -> Callable[[Callable[..., Awaitable[T]]], Callable[..., Awaitable[T]]]:
    """Decorator factory: retry `httpx` transient failures with exponential backoff.

    Backoff: `base_delay * 4 ** n` so attempts=3, base_delay=1 →
    delays of approximately 1s and 4s before the second and third attempts.
    """

    def deco(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            async for attempt in AsyncRetrying(
                reraise=True,
                stop=stop_after_attempt(attempts),
                wait=wait_exponential(
                    multiplier=base_delay, exp_base=4, max=base_delay * 64
                ),
                retry=retry_if_exception(_is_transient),
            ):
                with attempt:
                    result = await fn(*args, **kwargs)
            # ``reraise=True`` guarantees we either returned above or raised.
            return result

        return wrapper

    return deco
