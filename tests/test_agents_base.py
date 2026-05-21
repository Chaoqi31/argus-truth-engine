"""Tests for the agent base class."""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

from pydantic import BaseModel, Field

from argus.agents.base import AgentRunner, JsonRepairFailed, _extract_json
from argus.models.miromind import (
    ResponseCompletedEvent,
    ResponseOutputTextDeltaEvent,
    ResponseSummary,
    Usage,
)


class Out(BaseModel):
    verdict: str
    confidence: float = Field(ge=0, le=1)


def _completed(usage_total: int = 10) -> ResponseCompletedEvent:
    return ResponseCompletedEvent(
        type="response.completed",
        sequence_number=99,
        response=ResponseSummary(
            id="resp_x", status="completed", usage=Usage(total_tokens=usage_total)
        ),
    )


def _msg_delta(text: str, seq: int = 1) -> ResponseOutputTextDeltaEvent:
    return ResponseOutputTextDeltaEvent(
        type="response.output_text.delta",
        sequence_number=seq,
        item_id="msg_1",
        output_index=0,
        content_index=0,
        delta=text,
    )


def _events_seq(events: list[Any]) -> Any:
    async def gen() -> Any:
        for e in events:
            yield e

    return gen()


async def test_runs_once_when_json_is_valid() -> None:
    client = AsyncMock()
    client.submit_background = AsyncMock(return_value="resp_x")

    valid = '{"verdict":"ok","confidence":0.9}'
    client.stream = lambda rid, after=0: _events_seq(
        [_msg_delta(valid), _completed()]
    )

    runner = AgentRunner(client=client, model_cls=Out, agent_name="t")
    result = await runner.run(
        instructions="be a robot",
        input_text="hi",
    )

    assert result.parsed == Out(verdict="ok", confidence=0.9)
    assert client.submit_background.await_count == 1


async def test_repairs_once_then_succeeds() -> None:
    client = AsyncMock()
    rids = iter(["resp_first", "resp_repair"])
    client.submit_background = AsyncMock(side_effect=lambda **kw: next(rids))

    bad = "this is not json"
    fixed = '{"verdict":"ok","confidence":0.5}'
    streams = iter([[_msg_delta(bad), _completed()], [_msg_delta(fixed), _completed()]])
    client.stream = lambda rid, after=0: _events_seq(next(streams))

    runner = AgentRunner(client=client, model_cls=Out, agent_name="t")
    result = await runner.run(instructions=None, input_text="hi")
    assert result.parsed == Out(verdict="ok", confidence=0.5)
    assert client.submit_background.await_count == 2  # noqa: PLR2004


async def test_raises_after_repair_fails() -> None:
    client = AsyncMock()
    client.submit_background = AsyncMock(return_value="resp_x")
    bad = "still not json"
    streams = iter([[_msg_delta(bad), _completed()], [_msg_delta(bad), _completed()]])
    client.stream = lambda rid, after=0: _events_seq(next(streams))

    runner = AgentRunner(client=client, model_cls=Out, agent_name="t")
    try:
        await runner.run(instructions=None, input_text="hi")
    except JsonRepairFailed as exc:
        assert "JSON" in str(exc)
    else:
        raise AssertionError("expected JsonRepairFailed")


def test_extract_json_repairs_common_llm_damage() -> None:
    """Regression: MiroMind's streamed output occasionally drops punctuation.

    ``json-repair`` heuristically fixes common LLM damage (missing commas,
    trailing commas, unescaped strings). Structural damage like a missing
    colon between key and value cannot be fully recovered — those cases still
    fall through to the one-shot repair-prompt round-trip.
    """
    damaged = '{"type":"citation""importance":"high"}'
    parsed = json.loads(_extract_json(damaged))
    assert parsed["type"] == "citation"
    assert parsed["importance"] == "high"

    # Trailing comma — also fixable.
    trailing = '{"a":1,"b":2,}'
    assert json.loads(_extract_json(trailing)) == {"a": 1, "b": 2}

    # Clean JSON passes through untouched.
    clean = '{"verdict":"ok","confidence":0.9}'
    assert json.loads(_extract_json(clean))["verdict"] == "ok"
