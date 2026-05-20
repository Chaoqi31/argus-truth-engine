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
from collections.abc import AsyncIterator
from typing import Any

import httpx

from argus.config import Settings
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

    async def submit_background(
        self,
        *,
        input: str | list[dict[str, Any]],
        instructions: str | None,
        max_output_tokens: int | None = None,
        metadata: dict[str, str] | None = None,
    ) -> str:
        """POST /v1/responses with background=true; return the response id."""
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
    ) -> AsyncIterator[ResponseEvent]:
        """Stream typed events from GET /v1/responses/{id}?stream=true&after=<seq>."""
        url = f"{self._s.miromind_base_url}/responses/{response_id}"
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
