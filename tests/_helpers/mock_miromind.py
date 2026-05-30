"""Agent-keyed mock dispatcher for MiromindClient.

Why: LangGraph runs specialist agents in parallel, so `iter([stream1, stream2])`
patterns no longer match call order. Each `submit_background` carries
`metadata={"agent": "<name>", ...}`; we route on that.

Usage:
    router = StreamRouter()
    router.add("planner", [msg(planner_json), completed()])
    router.add("CitationVerifier", [tool(...), msg(...), completed()])
    router.add("CitationVerifier", [msg(...), completed()])  # second call

    client = router.make_client()
    job = await audit_pdf(..., client=client)

    # `router.calls_for("CitationVerifier")` returns the input_text seen on each call.
"""
from __future__ import annotations

import json
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock

from argus.models.miromind import (
    ResponseCompletedEvent,
    ResponseOutputItemDoneEvent,
    ResponseOutputTextDeltaEvent,
    ResponseSummary,
    Usage,
)

# --- helpers re-exported for test ergonomics -------------------------------


def msg(text: str, seq: int = 1) -> ResponseOutputTextDeltaEvent:
    return ResponseOutputTextDeltaEvent(
        type="response.output_text.delta",
        sequence_number=seq,
        item_id="msg",
        output_index=0,
        content_index=0,
        delta=text,
    )


def completed(
    seq: int = 99,
    tokens: int = 100,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> ResponseCompletedEvent:
    return ResponseCompletedEvent(
        type="response.completed",
        sequence_number=seq,
        response=ResponseSummary(
            id="resp_x",
            status="completed",
            usage=Usage(
                total_tokens=tokens,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            ),
        ),
    )


def tool(name: str, args: dict[str, Any], seq: int) -> ResponseOutputItemDoneEvent:
    return ResponseOutputItemDoneEvent(
        type="response.output_item.done",
        sequence_number=seq,
        output_index=1,
        item={
            "type": "tool_call",
            "id": f"tc_{seq}",
            "name": name,
            "arguments": json.dumps(args),
            "result": json.dumps({"ok": True}),
            "status": "completed",
        },
    )


# --- router ----------------------------------------------------------------


class StreamRouter:
    """Records pre-canned streams per agent; dispatches based on metadata."""

    def __init__(self) -> None:
        self._streams: dict[str, deque[list[Any]]] = defaultdict(deque)
        self._calls: dict[str, list[str]] = defaultdict(list)

    def add(self, agent: str, events: list[Any]) -> None:
        self._streams[agent].append(events)

    def calls_for(self, agent: str) -> list[str]:
        return list(self._calls[agent])

    def make_client(self) -> AsyncMock:
        client = AsyncMock()
        rid_counter = [0]
        rid_to_stream: dict[str, list[Any]] = {}

        async def submit(
            *,
            input: str | list[Any],
            instructions: str | None = None,
            max_output_tokens: int | None = None,
            metadata: dict[str, str] | None = None,
            idempotency_key: str | None = None,
        ) -> str:
            agent = (metadata or {}).get("agent", "unknown")
            self._calls[agent].append(
                input if isinstance(input, str) else json.dumps(input)
            )
            queue = self._streams.get(agent)
            if not queue:
                raise AssertionError(
                    f"StreamRouter has no pre-canned stream for agent={agent!r}; "
                    f"call .add({agent!r}, [...]) before invoking the client."
                )
            events = queue.popleft()
            rid_counter[0] += 1
            rid = f"resp_{agent}_{rid_counter[0]}"
            rid_to_stream[rid] = events
            return rid

        async def stream_gen(rid: str, after: int = 0) -> AsyncIterator[Any]:
            for ev in rid_to_stream[rid]:
                yield ev

        client.submit_background = AsyncMock(side_effect=submit)
        client.stream = lambda rid, after=0: stream_gen(rid, after)
        return client
