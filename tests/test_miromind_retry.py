"""Retry behaviour for MiromindClient.submit_background."""
from __future__ import annotations

import httpx
import pytest
import respx
from httpx import Response

from argus.config import Settings
from argus.miromind.client import MiromindClient


@respx.mock
async def test_submit_retries_on_429_then_succeeds() -> None:
    route = respx.post("https://api.miromind.ai/v1/responses")
    route.side_effect = [
        Response(429, json={"error": "rate-limited"}),
        Response(429, json={"error": "rate-limited"}),
        Response(200, json={"id": "resp_ok", "status": "in_progress"}),
    ]

    client = MiromindClient(
        Settings(miromind_api_key="sk", miromind_retry_base_delay_s=0.001)
    )
    rid = await client.submit_background(input="hi", instructions=None)
    assert rid == "resp_ok"
    assert route.call_count == 3  # noqa: PLR2004


@respx.mock
async def test_submit_does_not_retry_on_400() -> None:
    route = respx.post("https://api.miromind.ai/v1/responses").mock(
        return_value=Response(400, json={"error": "bad request"})
    )

    client = MiromindClient(
        Settings(miromind_api_key="sk", miromind_retry_base_delay_s=0.001)
    )

    with pytest.raises(httpx.HTTPStatusError):
        await client.submit_background(input="hi", instructions=None)
    assert route.call_count == 1


@respx.mock
async def test_submit_gives_up_after_attempts() -> None:
    route = respx.post("https://api.miromind.ai/v1/responses").mock(
        return_value=Response(503, json={"error": "down"})
    )

    client = MiromindClient(
        Settings(
            miromind_api_key="sk",
            miromind_retry_attempts=2,
            miromind_retry_base_delay_s=0.001,
        )
    )

    with pytest.raises(httpx.HTTPStatusError):
        await client.submit_background(input="hi", instructions=None)
    assert route.call_count == 2  # noqa: PLR2004
