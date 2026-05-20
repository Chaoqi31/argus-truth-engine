"""Tests for the raw SSE line decoder."""
from __future__ import annotations

from argus.miromind.sse import sse_iter_events

RAW = (
    b": heartbeat\n"
    b"event: response.created\n"
    b'data: {"type":"response.created","sequence_number":1,'
    b'"response":{"id":"resp_x","status":"in_progress"}}\n\n'
    b"event: response.reasoning_text.delta\n"
    b'data: {"type":"response.reasoning_text.delta","sequence_number":2,'
    b'"item_id":"rs_1","output_index":0,"content_index":0,"delta":"hello"}\n\n'
    b"event: response.completed\n"
    b'data: {"type":"response.completed","sequence_number":3,'
    b'"response":{"id":"resp_x","status":"completed","usage":{"total_tokens":7}}}\n\n'
)


def test_sse_iter_events_yields_three_events() -> None:
    events = list(sse_iter_events(iter([RAW])))
    assert [e.type for e in events] == [
        "response.created",
        "response.reasoning_text.delta",
        "response.completed",
    ]
    assert events[1].sequence_number == 2  # noqa: PLR2004


def test_sse_iter_events_skips_comments() -> None:
    payload = b": ping\n\n"
    events = list(sse_iter_events(iter([payload])))
    assert events == []


def test_sse_iter_events_handles_chunked_input() -> None:
    half_a = RAW[:80]
    half_b = RAW[80:]
    events = list(sse_iter_events(iter([half_a, half_b])))
    assert len(events) == 3  # noqa: PLR2004
