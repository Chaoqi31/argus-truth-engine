"""Tests for the MiroMind client using respx (HTTPX mock)."""
from __future__ import annotations

import respx
from httpx import Response

from argus.config import Settings
from argus.miromind.client import MiromindClient


@respx.mock
async def test_submit_background_returns_response_id() -> None:
    respx.post("https://api.miromind.ai/v1/responses").mock(
        return_value=Response(200, json={"id": "resp_abc", "status": "in_progress"})
    )

    client = MiromindClient(Settings(miromind_api_key="sk_live_x"))
    rid = await client.submit_background(input="hello", instructions=None)
    assert rid == "resp_abc"


@respx.mock
async def test_stream_yields_events_and_completes() -> None:
    respx.post("https://api.miromind.ai/v1/responses").mock(
        return_value=Response(200, json={"id": "resp_abc", "status": "in_progress"})
    )
    sse = (
        b'event: response.created\n'
        b'data: {"type":"response.created","sequence_number":1,'
        b'"response":{"id":"resp_abc","status":"in_progress"}}\n\n'
        b'event: response.completed\n'
        b'data: {"type":"response.completed","sequence_number":2,'
        b'"response":{"id":"resp_abc","status":"completed","usage":{"total_tokens":5}}}\n\n'
    )
    respx.get("https://api.miromind.ai/v1/responses/resp_abc").mock(
        return_value=Response(200, content=sse, headers={"content-type": "text/event-stream"})
    )

    client = MiromindClient(Settings(miromind_api_key="sk_live_x"))
    rid = await client.submit_background(input="hello", instructions=None)
    events = [ev async for ev in client.stream(rid, after=0)]
    assert [e.type for e in events] == ["response.created", "response.completed"]


@respx.mock
async def test_cancel_calls_cancel_endpoint() -> None:
    respx.post(
        "https://api.miromind.ai/v1/responses/resp_abc/cancel"
    ).mock(return_value=Response(200, json={"status": "cancelled"}))
    client = MiromindClient(Settings(miromind_api_key="sk_live_x"))
    await client.cancel("resp_abc")
    assert respx.calls.last is not None
    assert respx.calls.last.request.url.path.endswith("/cancel")
