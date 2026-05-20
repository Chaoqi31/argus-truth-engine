"""Smoke tests for the shared StreamRouter mock helper."""
from __future__ import annotations

import pytest

from tests._helpers.mock_miromind import StreamRouter, completed, msg


async def test_router_dispatches_by_agent() -> None:
    router = StreamRouter()
    router.add("planner", [msg('{"claims": []}'), completed()])
    router.add(
        "Reporter",
        [msg('{"executive_summary_md": "ok", "ranked_finding_ids": []}'), completed()],
    )
    client = router.make_client()

    rid_planner = await client.submit_background(
        input="planner input", instructions=None, metadata={"agent": "planner"}
    )
    assert rid_planner.startswith("resp_planner_")

    events = [e async for e in client.stream(rid_planner)]
    assert events[0].type == "response.output_text.delta"  # type: ignore[attr-defined]


async def test_router_raises_when_agent_unknown() -> None:
    router = StreamRouter()
    client = router.make_client()
    with pytest.raises(AssertionError):
        await client.submit_background(
            input="x", instructions=None, metadata={"agent": "Mystery"}
        )
