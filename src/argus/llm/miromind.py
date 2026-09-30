"""MiroMind Responses API transport.

Owns everything MiroMind-specific and nothing job-specific: the background
submit with retries, the SSE stream with reconnects, turning response items
into `Step`s, the process-wide rate limit, server-side cancel, and pricing.
It knows nothing about traces, budgets, or JSON output contracts.

The documented two-step pattern:

    1. POST /v1/responses           (background=true, stream=false) -> {"id": ...}
    2. GET  /v1/responses/{id}?stream=true&after=<seq>   typed SSE events,
       resumable from any sequence number
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Final
from uuid import uuid4

import httpx
from httpx_sse import aconnect_sse
from pydantic import SecretStr
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from argus.config import Settings
from argus.log import log
from argus.models.domain import Step, StepType

_PRICE_PER_MILLION: Final[dict[str, tuple[float, float]]] = {
    "mirothinker-1-7-deepresearch": (4.00, 25.00),
    "mirothinker-1-7-deepresearch-mini": (1.25, 10.00),
}
_PROMO_FACTOR: Final = 0.75  # 25% off, current MiroMind promo
_WEB_SEARCH_FEE_USD: Final = 0.05
_RETRY_STATUS_CODES: Final = frozenset({408, 425, 429, 500, 502, 503, 504})
_STREAM_RECONNECTS: Final = 3
_KEY_CHECK_TIMEOUT_S: Final = 20.0

StepSink = Callable[[Step], Awaitable[None]]


def price(*, model: str, input_tokens: int, output_tokens: int, web_searches: int) -> float:
    """USD for one response: list price times the promo factor, plus search fees."""
    in_per_m, out_per_m = _PRICE_PER_MILLION.get(
        model, _PRICE_PER_MILLION["mirothinker-1-7-deepresearch"]
    )
    tokens = input_tokens / 1e6 * in_per_m + output_tokens / 1e6 * out_per_m
    return tokens * _PROMO_FACTOR + web_searches * _WEB_SEARCH_FEE_USD


@dataclass(frozen=True)
class MiroMindAccess:
    """Whose key pays and which model runs, for one job. Resolved per request
    (BYOK header, saved key, or server key) and never persisted."""

    api_key: SecretStr
    model: str

    @classmethod
    def from_settings(cls, settings: Settings) -> MiroMindAccess:
        return cls(api_key=SecretStr(settings.miromind_api_key), model=settings.miromind_model)


class MiroMindError(Exception):
    """The request failed after retries, or the response ended in `response.failed`."""

    def __init__(self, message: str, *, response_id: str | None = None) -> None:
        super().__init__(message)
        self.response_id = response_id


class MiroMindTimeout(MiroMindError):
    """The response did not complete in time; it was cancelled server-side."""


@dataclass(frozen=True)
class MiroMindResponse:
    response_id: str
    text: str
    steps: tuple[Step, ...]
    total_tokens: int
    reasoning_tokens: int
    num_search_queries: int
    cost_usd: float


class TokenBucket:
    """Async token-bucket rate limiter, shared by every job in the process."""

    def __init__(self, *, rate_per_s: float, capacity: int) -> None:
        if rate_per_s <= 0:
            raise ValueError("rate_per_s must be > 0")
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        self._rate = rate_per_s
        self._capacity = capacity
        self._tokens = float(capacity)
        self._last: float | None = None
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = asyncio.get_running_loop().time()
                if self._last is None:
                    self._last = now
                self._tokens = min(self._capacity, self._tokens + (now - self._last) * self._rate)
                self._last = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                await asyncio.sleep((1 - self._tokens) / self._rate)


class MiroMind:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings
        self._base_url = settings.miromind_base_url
        self._bucket = TokenBucket(
            rate_per_s=settings.miromind_rps, capacity=settings.miromind_rps_burst
        )

    async def respond(
        self,
        access: MiroMindAccess,
        *,
        prompt: str,
        agent: str,
        max_output_tokens: int,
        idempotency_key: str | None,
        on_step: StepSink,
    ) -> MiroMindResponse:
        """Submit ``prompt`` and stream the response to completion.

        The prompt already carries the task instructions: MiroMind ignores the
        ``instructions`` field for these models. Completed steps reach
        ``on_step`` while the response streams. Raises `MiroMindTimeout` after
        ``miromind_response_timeout_s`` of streaming and `MiroMindError` when
        the request fails; on a timeout or cancellation the response is
        cancelled server-side so it stops being billed.
        """
        metadata = {"agent": agent}
        if idempotency_key is not None:
            metadata["idempotency_key"] = idempotency_key
        response_id = await self._submit(
            access,
            {
                "model": access.model,
                "input": prompt,
                "background": True,
                "stream": False,
                "max_output_tokens": max_output_tokens,
                "metadata": metadata,
            },
            idempotency_key,
            attempts=self._settings.miromind_retry_attempts,
            timeout_s=self._settings.miromind_request_timeout_s,
        )
        steps = _Steps(response_id, agent)
        text: list[str] = []
        usage: dict[str, Any] = {}
        timeout_s = self._settings.miromind_response_timeout_s
        try:
            async with asyncio.timeout(timeout_s):
                async for event in self._events(access, response_id):
                    for step in steps.feed(event):
                        await on_step(step)
                    kind = event.get("type")
                    if kind == "response.output_text.delta":
                        text.append(str(event.get("delta", "")))
                    elif kind == "response.completed":
                        usage = (event.get("response") or {}).get("usage") or {}
                    elif kind == "response.failed":
                        detail = event.get("error") or "response.failed"
                        raise MiroMindError(str(detail), response_id=response_id)
        except TimeoutError as exc:
            await asyncio.shield(self._cancel(access, response_id))
            raise MiroMindTimeout(
                f"{agent} response {response_id} timed out after {timeout_s:g}s",
                response_id=response_id,
            ) from exc
        except asyncio.CancelledError:
            await asyncio.shield(self._cancel(access, response_id))
            raise
        except httpx.HTTPError as exc:
            raise MiroMindError(str(exc), response_id=response_id) from exc
        input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
        searches = int(usage.get("num_search_queries") or 0)
        return MiroMindResponse(
            response_id=response_id,
            text="".join(text),
            steps=tuple(steps.steps),
            total_tokens=int(usage.get("total_tokens") or 0),
            reasoning_tokens=int(usage.get("reasoning_tokens") or 0),
            num_search_queries=searches,
            cost_usd=price(
                model=access.model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                web_searches=searches,
            ),
        )

    async def check_key(self, access: MiroMindAccess) -> str:
        """Submit a 4-token probe and cancel it; returns the probe's response id.
        Raises `MiroMindError` when MiroMind rejects the key."""
        response_id = await self._submit(
            access,
            {
                "model": access.model,
                "input": "Return the word OK.",
                "background": True,
                "stream": False,
                "max_output_tokens": 4,
                "metadata": {"argus_probe": "api_key_test"},
            },
            None,
            attempts=1,
            timeout_s=min(self._settings.miromind_request_timeout_s, _KEY_CHECK_TIMEOUT_S),
        )
        await self._cancel(access, response_id)
        return response_id

    def _headers(self, access: MiroMindAccess) -> dict[str, str]:
        return {"Authorization": f"Bearer {access.api_key.get_secret_value()}"}

    async def _submit(
        self,
        access: MiroMindAccess,
        body: dict[str, Any],
        idempotency_key: str | None,
        *,
        attempts: int,
        timeout_s: float,
    ) -> str:
        # The idempotency key is reused across transient retries of the same
        # payload, so a server that honors it bills the work unit once.
        headers = self._headers(access)
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        base_delay = self._settings.miromind_retry_base_delay_s
        response_id = ""
        try:
            async for attempt in AsyncRetrying(
                reraise=True,
                stop=stop_after_attempt(attempts),
                wait=wait_exponential(multiplier=base_delay, exp_base=4, max=base_delay * 64),
                retry=retry_if_exception(_is_transient),
            ):
                with attempt:
                    await self._bucket.acquire()
                    resp = await self._http.post(
                        f"{self._base_url}/responses", json=body, headers=headers, timeout=timeout_s
                    )
                    resp.raise_for_status()
                    response_id = str(resp.json()["id"])
        except httpx.HTTPError as exc:
            raise MiroMindError(str(exc)) from exc
        except (ValueError, KeyError, TypeError) as exc:
            raise MiroMindError(f"malformed submit response: {exc!r}") from exc
        log.info("miromind.submit", response_id=response_id)
        return response_id

    async def _events(
        self, access: MiroMindAccess, response_id: str
    ) -> AsyncIterator[dict[str, Any]]:
        """Typed events of one response. MiroMind sometimes drops the connection
        mid-stream; reconnecting with ``after=<last seq>`` keeps it gap-free."""
        url = f"{self._base_url}/responses/{response_id}"
        last_seq = 0
        reconnects_left = _STREAM_RECONNECTS
        while True:
            try:
                await self._bucket.acquire()
                async with aconnect_sse(
                    self._http,
                    "GET",
                    url,
                    params={"stream": "true", "after": str(last_seq)},
                    headers=self._headers(access),
                    timeout=self._settings.miromind_stream_timeout_s,
                ) as source:
                    source.response.raise_for_status()
                    async for sse in source.aiter_sse():
                        if not sse.data or sse.data == "[DONE]":
                            continue
                        event = _event(sse.data, response_id)
                        last_seq = max(last_seq, int(event.get("sequence_number", 0)))
                        yield event
                        if event.get("type") in ("response.completed", "response.failed"):
                            return
                return
            except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ReadTimeout) as exc:
                if reconnects_left == 0:
                    raise
                reconnects_left -= 1
                log.warning(
                    "miromind.stream_reconnect",
                    response_id=response_id,
                    after=last_seq,
                    attempts_left=reconnects_left,
                    error=type(exc).__name__,
                )

    async def _cancel(self, access: MiroMindAccess, response_id: str) -> None:
        with suppress(httpx.HTTPError):
            await self._http.post(
                f"{self._base_url}/responses/{response_id}/cancel",
                headers=self._headers(access),
                timeout=self._settings.miromind_request_timeout_s,
            )
            log.info("miromind.cancel", response_id=response_id)


def _event(data: str, response_id: str) -> dict[str, Any]:
    try:
        event = json.loads(data)
    except json.JSONDecodeError as exc:
        raise MiroMindError(f"malformed stream event: {exc}", response_id=response_id) from exc
    if not isinstance(event, dict) or not isinstance(event.get("sequence_number", 0), int):
        raise MiroMindError(f"malformed stream event: {data[:200]}", response_id=response_id)
    return event


def _is_transient(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRY_STATUS_CODES
    return isinstance(exc, httpx.RequestError)


# --- Response items -> Steps ------------------------------------------------

# The deep-research model emits provider-specific tool names (e.g.
# `google_search`), so the known variants are aliased; unknown names fall back
# to a generic tool_call.
_TOOL_NAME_TO_STEP: Final[dict[str, StepType]] = {
    "web_search": StepType.WEB_SEARCH,
    "google_search": StepType.WEB_SEARCH,
    "search": StepType.WEB_SEARCH,
    "fetch_url_content": StepType.FETCH_URL_CONTENT,
    "fetch_url": StepType.FETCH_URL_CONTENT,
    "open_url": StepType.FETCH_URL_CONTENT,
    "open_page": StepType.FETCH_URL_CONTENT,
    "visit_page": StepType.FETCH_URL_CONTENT,
    "browse": StepType.FETCH_URL_CONTENT,
    "web_fetch": StepType.FETCH_URL_CONTENT,
    "scrape_and_extract_info": StepType.FETCH_URL_CONTENT,
    "download_file_from_internet_to_sandbox": StepType.FETCH_URL_CONTENT,
    "execute_python": StepType.EXECUTE_PYTHON,
    "run_python": StepType.EXECUTE_PYTHON,
    "run_python_code": StepType.EXECUTE_PYTHON,
    "python": StepType.EXECUTE_PYTHON,
    "code_interpreter": StepType.EXECUTE_PYTHON,
    "execute_command": StepType.EXECUTE_COMMAND,
}


class _Steps:
    """Turns response events into steps.

    A tool call surfaces twice (``output_item.added`` in progress, then
    ``output_item.done`` with its result); both update one step, which is
    emitted once it completes. Reasoning deltas are buffered and become one
    thinking step when their reasoning item closes.
    """

    def __init__(self, response_id: str, agent: str) -> None:
        self._response_id = response_id
        self._agent = agent
        self.steps: list[Step] = []
        self._thinking: list[str] = []
        self._tools: dict[str, Step] = {}
        self._unknown_tools: set[str] = set()

    def feed(self, event: dict[str, Any]) -> list[Step]:
        kind = event.get("type")
        if kind == "response.reasoning_text.delta":
            self._thinking.append(str(event.get("delta", "")))
            return []
        if kind not in ("response.output_item.added", "response.output_item.done"):
            return []
        item: dict[str, Any] = event.get("item") or {}
        completed = kind == "response.output_item.done" or item.get("status") == "completed"
        item_type = item.get("type", "tool_call")
        if item_type == "tool_call":
            return self._tool_call(event, item, completed)
        if item_type == "reasoning" and self._thinking:
            thought = "".join(self._thinking)
            self._thinking.clear()
            return [self._add(event, StepType.THINKING, _truncate(thought), {"thought": thought})]
        return []

    def _tool_call(
        self, event: dict[str, Any], item: dict[str, Any], completed: bool
    ) -> list[Step]:
        name = str(item.get("name", ""))
        if name and name not in _TOOL_NAME_TO_STEP and name not in self._unknown_tools:
            self._unknown_tools.add(name)
            log.warning("agent.unknown_tool_name", agent=self._agent, tool_name=name)
        summary = _tool_call_summary(name, item)
        item_id = item.get("id")
        step = self._tools.get(item_id) if item_id else None
        if step is not None:
            step.content = item
            step.summary = summary
        else:
            step = self._add(event, _TOOL_NAME_TO_STEP.get(name, StepType.TOOL_CALL), summary, item)
            if item_id:
                self._tools[item_id] = step
        return [step] if completed else []

    def _add(
        self, event: dict[str, Any], step_type: StepType, summary: str, content: dict[str, Any]
    ) -> Step:
        step = Step(
            id=f"step_{uuid4().hex[:12]}",
            trace_id=self._response_id,
            sequence=int(event.get("sequence_number", 0)),
            type=step_type,
            summary=summary,
            content=content,
        )
        self.steps.append(step)
        return step


def _truncate(s: str, n: int = 140) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def _tool_call_summary(tool_name: str, item: dict[str, Any]) -> str:
    """The most useful argument for display: the query, the URL, the code."""
    args = item.get("arguments", item.get("call", {}))
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except (json.JSONDecodeError, TypeError):
            args = {}
    if not isinstance(args, dict):
        args = {}
    step_type = _TOOL_NAME_TO_STEP.get(tool_name, StepType.TOOL_CALL)
    if step_type == StepType.WEB_SEARCH and (query := args.get("query", args.get("q", ""))):
        return f"search: {_truncate(str(query), 120)}"
    if step_type == StepType.FETCH_URL_CONTENT and (url := args.get("url", "")):
        return f"fetch: {_truncate(str(url), 120)}"
    code = args.get("code_block", args.get("code", ""))
    if step_type == StepType.EXECUTE_PYTHON and code:
        return f"python: {_truncate(str(code).split(chr(10))[0], 100)}"
    first = next(iter(args.values()), "")
    if first and isinstance(first, str):
        return f"{tool_name}: {_truncate(first, 100)}"
    return tool_name or "tool_call"
