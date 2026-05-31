"""Tests for the raw SSE line decoder."""
from __future__ import annotations

from argus.miromind.sse import SSEDecoder, sse_iter_events

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
    assert events[1].sequence_number == 2


def test_sse_iter_events_skips_comments() -> None:
    payload = b": ping\n\n"
    events = list(sse_iter_events(iter([payload])))
    assert events == []


def test_sse_iter_events_handles_chunked_input() -> None:
    half_a = RAW[:80]
    half_b = RAW[80:]
    events = list(sse_iter_events(iter([half_a, half_b])))
    assert len(events) == 3


def _decode_in_chunks(raw: bytes, sizes: list[int]) -> list:
    """Feed ``raw`` to one SSEDecoder, split into chunks of the given sizes."""
    decoder = SSEDecoder()
    events = []
    pos = 0
    for n in sizes:
        events.extend(decoder.feed(raw[pos:pos + n]))
        pos += n
    events.extend(decoder.feed(raw[pos:]))
    events.extend(decoder.flush())
    return events


def test_sse_decoder_recovers_events_split_at_every_byte_boundary() -> None:
    """An event split across a chunk boundary must NOT be lost — regression for
    the per-chunk-parser bug that dropped any straddling event."""
    for i in range(1, len(RAW)):
        events = _decode_in_chunks(RAW, [i])  # split into RAW[:i] + RAW[i:]
        types = [e.type for e in events]
        assert types == [
            "response.created",
            "response.reasoning_text.delta",
            "response.completed",
        ], f"lost an event when split at byte {i}: {types}"


def test_sse_decoder_one_byte_at_a_time() -> None:
    """Worst-case TCP segmentation: every byte its own chunk. All events survive."""
    decoder = SSEDecoder()
    events = []
    for b in range(len(RAW)):
        events.extend(decoder.feed(RAW[b:b + 1]))
    events.extend(decoder.flush())
    assert [e.type for e in events] == [
        "response.created",
        "response.reasoning_text.delta",
        "response.completed",
    ]
    # The delta payload must be intact, not missing characters.
    assert events[1].delta == "hello"
