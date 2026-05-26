"""MiroMind Responses API client.

Implements the documented two-step pattern (spec §6.1.1):

    1. POST /v1/responses           (background=true, stream=false)
       → returns { "id": "resp_…", "status": "in_progress" }
    2. GET  /v1/responses/{id}?stream=true&after=<seq>
       → SSE typed-event stream; resumable from any sequence number

This client is intentionally low-level. Agent-specific logic (prompts,
JSON validation, repair retries) lives in argus.agents.*.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx

from argus.config import Settings
from argus.engineering import retry_on_transient
from argus.log import log
from argus.miromind.sse import sse_iter_events
from argus.models.miromind import ResponseEvent


class MiromindClient:
    """Thin async client for the Responses API."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._headers = {
            "Authorization": f"Bearer {settings.miromind_api_key}",
            "Content-Type": "application/json",
        }
        # Process-wide rate limit shared across submit + stream. Created
        # eagerly so the first call sees a fully-filled bucket.
        from argus.engineering import TokenBucket  # local import: avoid cycle
        self._bucket = TokenBucket(
            rate_per_s=settings.miromind_rps,
            capacity=settings.miromind_rps_burst,
        )
        self._submit_once: Callable[..., Awaitable[str]] = retry_on_transient(
            attempts=settings.miromind_retry_attempts,
            base_delay=settings.miromind_retry_base_delay_s,
        )(self._submit_background_once)

    async def submit_background(
        self,
        *,
        input: str | list[dict[str, Any]],
        instructions: str | None,
        max_output_tokens: int | None = None,
        metadata: dict[str, str] | None = None,
    ) -> str:
        """POST /v1/responses with background=true; return the response id.

        Wrapped with :func:`retry_on_transient`, so 408/425/429/5xx and
        :class:`httpx.RequestError` failures are retried with exponential
        backoff per :attr:`Settings.miromind_retry_attempts`.
        """
        return await self._submit_once(
            input=input,
            instructions=instructions,
            max_output_tokens=max_output_tokens,
            metadata=metadata,
        )

    async def _submit_background_once(
        self,
        *,
        input: str | list[dict[str, Any]],
        instructions: str | None,
        max_output_tokens: int | None,
        metadata: dict[str, str] | None,
    ) -> str:
        await self._bucket.acquire()
        body: dict[str, Any] = {
            "model": self._s.miromind_model,
            "input": input,
            "background": True,
            "stream": False,
        }
        if instructions is not None:
            body["instructions"] = instructions
        if max_output_tokens is not None:
            body["max_output_tokens"] = max_output_tokens
        if metadata is not None:
            body["metadata"] = metadata

        async with httpx.AsyncClient(
            timeout=self._s.miromind_request_timeout_s
        ) as http:
            resp = await http.post(
                f"{self._s.miromind_base_url}/responses",
                headers=self._headers,
                content=json.dumps(body),
            )
            resp.raise_for_status()
            data = resp.json()
            log.info("miromind.submit", response_id=data.get("id"))
            return str(data["id"])

    async def stream(
        self,
        response_id: str,
        *,
        after: int = 0,
        max_reconnects: int = 3,
    ) -> AsyncIterator[ResponseEvent]:
        """Stream typed events from GET /v1/responses/{id}?stream=true&after=<seq>.

        The MiroMind server sometimes drops the SSE connection mid-stream. We
        recover by reconnecting with `?after=<last_seq>` (up to `max_reconnects`
        times), so the caller sees a continuous, gap-free stream.
        """
        url = f"{self._s.miromind_base_url}/responses/{response_id}"
        last_seq = after
        attempts_left = max_reconnects

        while True:
            try:
                async for ev in self._stream_once(url, after=last_seq):
                    last_seq = max(last_seq, ev.sequence_number)
                    yield ev
                    if ev.type in {"response.completed", "response.failed"}:
                        return
                return  # stream ended without a terminal event
            except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ReadTimeout) as exc:
                if attempts_left <= 0:
                    raise
                attempts_left -= 1
                log.warning(
                    "miromind.stream_reconnect",
                    response_id=response_id,
                    after=last_seq,
                    attempts_left=attempts_left,
                    error=type(exc).__name__,
                )

    async def _stream_once(
        self, url: str, *, after: int
    ) -> AsyncIterator[ResponseEvent]:
        await self._bucket.acquire()
        params = {"stream": "true", "after": str(after)}
        async with (
            httpx.AsyncClient(timeout=self._s.miromind_stream_timeout_s) as http,
            http.stream("GET", url, headers=self._headers, params=params) as resp,
        ):
            resp.raise_for_status()
            async for chunk in resp.aiter_raw():
                for ev in sse_iter_events(iter([chunk])):
                    yield ev

    async def cancel(self, response_id: str) -> None:
        """POST /v1/responses/{id}/cancel — idempotent."""
        url = f"{self._s.miromind_base_url}/responses/{response_id}/cancel"
        async with httpx.AsyncClient(
            timeout=self._s.miromind_request_timeout_s
        ) as http:
            resp = await http.post(url, headers=self._headers)
            resp.raise_for_status()
            log.info("miromind.cancel", response_id=response_id)
