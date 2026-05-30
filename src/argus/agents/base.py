"""AgentRunner — generic wrapper around one MiroMind Responses call.

Responsibilities:
  - Submit the request (background mode).
  - Consume the stream to completion, collecting every event into a
    ReasoningTrace plus the final text payload.
  - Validate the final text as JSON matching ``model_cls``.
  - On validation failure, send ONE repair request appending the error
    text; if that also fails, raise :class:`JsonRepairFailed`.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import json_repair
from pydantic import BaseModel, ValidationError

from argus.log import log
from argus.miromind.client import MiromindClient
from argus.models.domain import Step, StepType
from argus.models.miromind import (
    ResponseCompletedEvent,
    ResponseEvent,
    ResponseFailedEvent,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
    ResponseOutputTextDeltaEvent,
    ResponseReasoningTextDeltaEvent,
)


class JsonRepairFailed(RuntimeError):
    """Raised when the model could not produce valid JSON even after one repair."""


@dataclass
class StreamCollection:
    """Result of consuming one Responses stream.

    Captures both ``input_tokens`` and ``output_tokens`` separately so the
    cost calculator can apply the correct per-direction price — the input
    and output rates differ by ~8x on mirothinker models, and charging
    every token at the output rate overestimates the bill by 5-6x.
    """

    response_id: str
    final_text: str = ""
    steps: list[Step] = field(default_factory=list)
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    num_search_queries: int = 0
    failed: bool = False
    failure_summary: str = ""


@dataclass
class AgentResult[T: BaseModel]:
    parsed: T
    streams: list[StreamCollection]  # length 1 or 2 (repaired)

    @property
    def first(self) -> StreamCollection:
        return self.streams[0]

    @property
    def final(self) -> StreamCollection:
        return self.streams[-1]


class AgentRunner[T: BaseModel]:
    """Runs one Responses-API call with JSON validation + one-shot repair."""

    def __init__(
        self,
        *,
        client: MiromindClient,
        model_cls: type[T],
        agent_name: str,
        max_output_tokens: int | None = 8000,
    ) -> None:
        self._client = client
        self._model_cls = model_cls
        self._agent_name = agent_name
        self._max_tokens = max_output_tokens

    async def run(
        self,
        *,
        instructions: str | None,
        input_text: str,
        idempotency_key: str | None = None,
    ) -> AgentResult[T]:
        first = await self._round_trip(
            instructions=instructions,
            input_text=input_text,
            idempotency_key=idempotency_key,
        )
        try:
            parsed = self._validate(first.final_text)
            return AgentResult(parsed=parsed, streams=[first])
        except (ValidationError, json.JSONDecodeError) as ve:
            err_text = str(ve)
            log.warning(
                "agent.json_invalid",
                agent=self._agent_name,
                error=err_text,
                raw_text_snippet=first.final_text[:500],
            )

        repair_input = (
            f"{input_text}\n\n"
            "---\n"
            "Your previous output failed JSON validation with this error:\n"
            f"{err_text}\n"
            "Please re-emit ONLY a valid JSON object matching the required schema. "
            "Do not include any prose, code fences, or commentary."
        )
        # The repair round-trip sends a *different* payload (the original input
        # plus the validation error), so it must NOT reuse the first request's
        # idempotency key: a server that honors Idempotency-Key would return the
        # cached (malformed) response and the repair would be a silent no-op.
        repair_key = f"{idempotency_key}:repair" if idempotency_key else None
        second = await self._round_trip(
            instructions=instructions,
            input_text=repair_input,
            idempotency_key=repair_key,
        )
        try:
            parsed = self._validate(second.final_text)
            return AgentResult(parsed=parsed, streams=[first, second])
        except (ValidationError, json.JSONDecodeError) as ve2:
            raise JsonRepairFailed(
                f"agent={self._agent_name}: JSON invalid after repair: {ve2}\n"
                f"--- first raw (first 800 chars) ---\n{first.final_text[:800]}\n"
                f"--- second raw (first 800 chars) ---\n{second.final_text[:800]}"
            ) from ve2

    async def _round_trip(
        self,
        *,
        instructions: str | None,
        input_text: str,
        idempotency_key: str | None = None,
    ) -> StreamCollection:
        # MiroMind's Responses API silently ignores `instructions` and the
        # `{role: "system"}` channel for many models — verified empirically
        # against `mirothinker-1-7-deepresearch-mini`. We embed the system
        # prompt directly into the input text so the model actually sees it.
        combined = (
            f"{instructions}\n\n---\n\n{input_text}" if instructions else input_text
        )
        rid = await self._client.submit_background(
            input=combined,
            instructions=None,
            max_output_tokens=self._max_tokens,
            metadata={"agent": self._agent_name},
            idempotency_key=idempotency_key,
        )
        collected = StreamCollection(response_id=rid)
        thinking_buf: list[str] = []
        text_buf: list[str] = []

        async for ev in self._client.stream(rid, after=0):
            self._record_step(collected, ev, thinking_buf, text_buf)
            if isinstance(ev, ResponseCompletedEvent):
                usage = ev.response.usage
                collected.total_tokens = usage.total_tokens
                # MiroMind's actual SSE Usage uses input_tokens/output_tokens;
                # the legacy OpenAI-style prompt_tokens/completion_tokens are
                # populated as a fallback in our Pydantic model. Prefer the
                # MiroMind names but fall back to legacy if the API ever flips.
                collected.input_tokens = usage.input_tokens or usage.prompt_tokens
                collected.output_tokens = usage.output_tokens or usage.completion_tokens
                collected.reasoning_tokens = usage.reasoning_tokens
                collected.num_search_queries = usage.num_search_queries
            elif isinstance(ev, ResponseFailedEvent):
                collected.failed = True
                collected.failure_summary = str(ev.error or "response.failed")

        if text_buf:
            collected.final_text = "".join(text_buf)
        return collected

    def _record_step(
        self,
        collected: StreamCollection,
        ev: ResponseEvent,
        thinking_buf: list[str],
        text_buf: list[str],
    ) -> None:
        if isinstance(ev, ResponseReasoningTextDeltaEvent):
            thinking_buf.append(ev.delta)
        elif isinstance(ev, ResponseOutputTextDeltaEvent):
            text_buf.append(ev.delta)
        elif isinstance(ev, ResponseOutputItemAddedEvent | ResponseOutputItemDoneEvent):
            item = ev.item or {}
            kind = item.get("type", "tool_call")
            if kind == "tool_call":
                tool_name = item.get("name", "")
                step_type = _TOOL_NAME_TO_STEP.get(tool_name, StepType.TOOL_CALL)
                summary = _tool_call_summary(tool_name, item)
                collected.steps.append(
                    Step(
                        id=f"step_{uuid4().hex[:12]}",
                        trace_id=collected.response_id,
                        sequence=ev.sequence_number,
                        type=step_type,
                        summary=summary,
                        content=item,
                    )
                )
            elif kind == "reasoning" and thinking_buf:
                collected.steps.append(
                    Step(
                        id=f"step_{uuid4().hex[:12]}",
                        trace_id=collected.response_id,
                        sequence=ev.sequence_number,
                        type=StepType.THINKING,
                        summary=_truncate("".join(thinking_buf)),
                        content={"thought": "".join(thinking_buf)},
                    )
                )
                thinking_buf.clear()

    def _validate(self, text: str) -> T:
        return self._model_cls.model_validate_json(_extract_json(text))


_TOOL_NAME_TO_STEP: dict[str, StepType] = {
    "web_search": StepType.WEB_SEARCH,
    "fetch_url_content": StepType.FETCH_URL_CONTENT,
    "execute_python": StepType.EXECUTE_PYTHON,
    "execute_command": StepType.EXECUTE_COMMAND,
}

_TRUNCATE_DEFAULT = 140


def _truncate(s: str, n: int = _TRUNCATE_DEFAULT) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def _tool_call_summary(tool_name: str, item: dict[str, Any]) -> str:
    """Extract a human-readable summary from a MiroMind tool call item.

    MiroMind's tool_call items carry arguments in various nested shapes.
    We pull out the most useful field for display — the search query for
    web_search, the URL for fetch_url_content, etc.
    """
    # Try common argument locations
    args = item.get("arguments", item.get("call", {}))
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except (json.JSONDecodeError, TypeError):
            args = {}

    if tool_name == "web_search":
        query = args.get("query", args.get("q", ""))
        if query:
            return f"search: {_truncate(query, 120)}"
    elif tool_name == "fetch_url_content":
        url = args.get("url", "")
        if url:
            return f"fetch: {_truncate(url, 120)}"
    elif tool_name == "execute_python":
        code = args.get("code", "")
        if code:
            return f"python: {_truncate(code.split(chr(10))[0], 100)}"

    # Fallback: show tool name + first argument value if any
    if args and isinstance(args, dict):
        first_val = next(iter(args.values()), "")
        if first_val and isinstance(first_val, str):
            return f"{tool_name}: {_truncate(first_val, 100)}"
    return tool_name or "tool_call"


def _unwrap_single_element_array(text: str) -> str:
    """If *text* is a JSON array containing exactly one object, return that object.

    MiroMind's deep-research models occasionally wrap the result in ``[{…}]``
    instead of ``{…}``.  Pydantic expects an object, so we unwrap it here.
    """
    parsed = json.loads(text)
    if isinstance(parsed, list) and len(parsed) == 1 and isinstance(parsed[0], dict):
        return json.dumps(parsed[0], ensure_ascii=False)
    return text


def _extract_json(text: str) -> str:
    """Strip whitespace / fences and return what looks like the JSON object.

    MiroMind's streamed output occasionally drops quotes, commas, or colons
    mid-buffer (mid-token boundary issues). We first try strict ``json.loads``;
    if that fails, ``json_repair`` heuristically fixes common LLM JSON damage
    (missing quotes/commas, trailing commas, unescaped strings) and we retry.
    Only if both fail do we raise ``json.JSONDecodeError`` for the caller's
    repair-prompt fallback.
    """
    text = text.strip()
    if text.startswith("```"):
        first = text.find("\n", 3)
        last = text.rfind("```")
        if first != -1 and last > first:
            text = text[first + 1 : last].strip()
    if "{" in text and "}" in text:
        start = text.find("{")
        end = text.rfind("}") + 1
        text = text[start:end]
    try:
        json.loads(text)
        return _unwrap_single_element_array(text)
    except json.JSONDecodeError:
        pass
    # json_repair returns "" if it can't recover anything useful.
    repaired = json_repair.repair_json(text)
    if not repaired or repaired in ("{}", "[]", '""'):
        # Force the caller into the repair-prompt fallback by raising.
        raise json.JSONDecodeError("json_repair could not recover", text, 0)
    # Sanity-check that the repaired text now parses.
    json.loads(repaired)
    return _unwrap_single_element_array(repaired)
