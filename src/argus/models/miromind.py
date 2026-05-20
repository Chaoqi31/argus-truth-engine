"""Typed wrappers over MiroMind Responses API SSE events.

The Responses API delivers a typed event stream documented at
https://platform.miromind.ai/docs/responses-api. We parse a deliberately
small subset — the events we actually consume in the orchestrator — and
fall back to a generic ResponseEvent for anything else (so unknown event
types do not crash the parser).
"""
from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictBase(BaseModel):
    model_config = ConfigDict(extra="allow")  # tolerate future fields


class Usage(_StrictBase):
    # Legacy OpenAI-style names (kept for backward compat; not emitted by MiroMind).
    prompt_tokens: int = 0
    completion_tokens: int = 0
    # MiroMind's actual field names (observed in live SSE response.completed payloads).
    input_tokens: int = 0
    output_tokens: int = 0
    # Both APIs send this.
    total_tokens: int = 0
    reasoning_tokens: int = 0
    num_search_queries: int = 0


class ResponseSummary(_StrictBase):
    id: str
    status: str
    usage: Usage = Field(default_factory=Usage)


class ResponseEvent(_StrictBase):
    """Generic envelope. Subclasses below specialise common event types."""

    type: str
    sequence_number: int


class ResponseCreatedEvent(ResponseEvent):
    type: Literal["response.created"]
    response: ResponseSummary


class ResponseInProgressEvent(ResponseEvent):
    type: Literal["response.in_progress"]


class ResponseOutputItemAddedEvent(ResponseEvent):
    type: Literal["response.output_item.added"]
    output_index: int
    item: dict[str, Any]


class ResponseOutputItemDoneEvent(ResponseEvent):
    type: Literal["response.output_item.done"]
    output_index: int
    item: dict[str, Any]


class ResponseReasoningTextDeltaEvent(ResponseEvent):
    type: Literal["response.reasoning_text.delta"]
    item_id: str
    output_index: int
    content_index: int
    delta: str


class ResponseOutputTextDeltaEvent(ResponseEvent):
    type: Literal["response.output_text.delta"]
    item_id: str
    output_index: int
    content_index: int
    delta: str


class ResponseOutputTextDoneEvent(ResponseEvent):
    type: Literal["response.output_text.done"]


class ResponseCompletedEvent(ResponseEvent):
    type: Literal["response.completed"]
    response: ResponseSummary


class ResponseFailedEvent(ResponseEvent):
    type: Literal["response.failed"]
    response: ResponseSummary | None = None
    error: dict[str, Any] | None = None


_KNOWN: dict[str, type[ResponseEvent]] = {
    "response.created": ResponseCreatedEvent,
    "response.in_progress": ResponseInProgressEvent,
    "response.output_item.added": ResponseOutputItemAddedEvent,
    "response.output_item.done": ResponseOutputItemDoneEvent,
    "response.reasoning_text.delta": ResponseReasoningTextDeltaEvent,
    "response.output_text.delta": ResponseOutputTextDeltaEvent,
    "response.output_text.done": ResponseOutputTextDoneEvent,
    "response.completed": ResponseCompletedEvent,
    "response.failed": ResponseFailedEvent,
}


def parse_event(payload: str) -> ResponseEvent:
    """Parse a single SSE `data:` payload into the most specific known type.

    Falls back to the generic ResponseEvent so unknown event types are
    surfaced upstream instead of raising.
    """
    obj = json.loads(payload)
    cls = _KNOWN.get(obj.get("type", ""), ResponseEvent)
    return cls.model_validate(obj)
