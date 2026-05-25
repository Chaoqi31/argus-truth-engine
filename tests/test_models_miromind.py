"""Tests for MiroMind SSE event type parsing."""
from __future__ import annotations

import json

from argus.models.miromind import (
    ResponseCompletedEvent,
    ResponseEvent,
    ResponseReasoningTextDeltaEvent,
    parse_event,
)

REASONING_DELTA = {
    "type": "response.reasoning_text.delta",
    "sequence_number": 4,
    "item_id": "rs_abc",
    "output_index": 0,
    "content_index": 0,
    "delta": "Thinking about ...",
}

COMPLETED = {
    "type": "response.completed",
    "sequence_number": 99,
    "response": {
        "id": "resp_xyz",
        "status": "completed",
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
            "reasoning_tokens": 30,
            "num_search_queries": 2,
        },
    },
}


def test_parse_event_reasoning_delta() -> None:
    ev = parse_event(json.dumps(REASONING_DELTA))
    assert isinstance(ev, ResponseReasoningTextDeltaEvent)
    assert ev.delta == "Thinking about ..."
    assert ev.sequence_number == 4


def test_parse_event_completed() -> None:
    ev = parse_event(json.dumps(COMPLETED))
    assert isinstance(ev, ResponseCompletedEvent)
    assert ev.response.usage.num_search_queries == 2


def test_parse_event_unknown_type_returns_generic() -> None:
    ev = parse_event(json.dumps({"type": "response.unknown.delta", "sequence_number": 7}))
    assert isinstance(ev, ResponseEvent)
    assert ev.sequence_number == 7
