"""LLM access: one call shape for every task, over two providers.

`Transports` is opened once per process: one pooled HTTP client, the MiroMind
rate limit and retry policy. `Llm` is built per job; it binds the caller's
MiroMind key and model (BYOK) and routes each `Task` to a provider. It owns the
JSON output contract (one parse, one repair round) for both providers. A call
site never picks a provider, builds a prompt envelope, reads SSE, retries,
repairs JSON, or prices tokens. Budget enforcement is not here: `Usage`
reports what each call cost and the pipeline decides whether the job may
spend more.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal

import httpx
from pydantic import BaseModel

from argus.config import Settings
from argus.llm.deepseek import DeepSeek, DeepSeekError
from argus.llm.miromind import (
    MiroMind,
    MiroMindAccess,
    MiroMindError,
    MiroMindTimeout,
    StepSink,
)
from argus.llm.output import OutputError, parse_output, repair_prompt
from argus.log import log
from argus.models.domain import Step

Engine = Literal["miromind", "deepseek"]


class Route(StrEnum):
    """Where a task may run. Declared on the task, next to its prompt."""

    DEEP_RESEARCH = "deep_research"  # MiroMind only: needs web search, fetch, python
    TEXT = "text"  # DeepSeek when configured, else MiroMind
    DEEPSEEK_ONLY = "deepseek_only"  # cheap pre-filtering; skipped without DeepSeek


@dataclass(frozen=True)
class Task[T: BaseModel]:
    """One kind of LLM work: who does it, where it may run, what it returns."""

    agent: str
    route: Route
    instructions: str
    output: type[T]
    max_output_tokens: int


@dataclass(frozen=True)
class Usage:
    """What a call consumed, over every attempt it made."""

    response_ids: tuple[str, ...] = ()
    total_tokens: int = 0
    reasoning_tokens: int = 0
    num_search_queries: int = 0
    cost_usd: float = 0.0

    def __add__(self, other: Usage) -> Usage:
        return Usage(
            response_ids=self.response_ids + other.response_ids,
            total_tokens=self.total_tokens + other.total_tokens,
            reasoning_tokens=self.reasoning_tokens + other.reasoning_tokens,
            num_search_queries=self.num_search_queries + other.num_search_queries,
            cost_usd=self.cost_usd + other.cost_usd,
        )


@dataclass(frozen=True)
class Answered[T: BaseModel]:
    output: T
    engine: Engine
    usage: Usage
    steps: tuple[Step, ...]


@dataclass(frozen=True)
class Failed:
    """The task produced no usable output. Returned, never raised: each caller
    decides what a failure means for the audit."""

    reason: Literal["timeout", "unparseable", "request_error"]
    detail: str
    engine: Engine
    usage: Usage
    steps: tuple[Step, ...]


type Answer[T: BaseModel] = Answered[T] | Failed


@dataclass
class _Attempts:
    usage: Usage = Usage()
    steps: list[Step] = field(default_factory=list)


class Llm:
    """Per-job LLM gateway. Cheap to build; holds no connections of its own."""

    def __init__(
        self, *, miromind: MiroMind, deepseek: DeepSeek | None, access: MiroMindAccess
    ) -> None:
        self._miromind = miromind
        self._deepseek = deepseek
        self._access = access

    @property
    def model(self) -> str:
        return self._access.model

    def engine(self, task: Task[BaseModel]) -> Engine | None:
        """The engine `ask` would use for ``task``, or None when the task cannot
        run (a DeepSeek-only task without DeepSeek)."""
        if task.route is Route.DEEP_RESEARCH:
            return "miromind"
        if self._deepseek is not None:
            return "deepseek"
        return "miromind" if task.route is Route.TEXT else None

    async def ask[T: BaseModel](
        self,
        task: Task[T],
        prompt: str,
        *,
        on_step: StepSink | None = None,
        idempotency_key: str | None = None,
    ) -> Answer[T]:
        """Run ``task`` on ``prompt`` and parse the output into ``task.output``.

        Output that does not parse is asked for once more on the same provider,
        with the validation error appended; both attempts count in the returned
        usage and steps. Timeouts, request failures and output that still does
        not parse come back as `Failed`. Only cancellation is raised.
        """
        engine = self.engine(task)
        if engine is None:
            raise ValueError(f"{task.agent} needs DeepSeek, which is not configured")
        attempts = _Attempts()

        async def record(step: Step) -> None:
            attempts.steps.append(step)
            if on_step is not None:
                await on_step(step)

        attempt_prompt, attempt_key = prompt, idempotency_key
        for attempt in (1, 2):
            try:
                text = await self._call(engine, task, attempt_prompt, attempt_key, record, attempts)
            except MiroMindTimeout as exc:
                return self._failed("timeout", exc, engine, attempts)
            except (MiroMindError, DeepSeekError) as exc:
                return self._failed("request_error", exc, engine, attempts)
            try:
                output = parse_output(text, task.output)
            except OutputError as exc:
                if attempt == 2:
                    return self._failed("unparseable", exc, engine, attempts)
                log.warning("agent.json_invalid", agent=task.agent, error=str(exc)[:500])
                # The repair sends a different payload, so it must not reuse the
                # first request's idempotency key.
                attempt_prompt = repair_prompt(prompt, exc)
                attempt_key = f"{idempotency_key}:repair" if idempotency_key else None
                continue
            return Answered(output, engine, attempts.usage, tuple(attempts.steps))
        raise AssertionError("unreachable")

    async def _call(
        self,
        engine: Engine,
        task: Task[BaseModel],
        prompt: str,
        idempotency_key: str | None,
        record: StepSink,
        attempts: _Attempts,
    ) -> str:
        if engine == "deepseek":
            assert self._deepseek is not None
            chat = await self._deepseek.chat(
                system=task.instructions, user=prompt, max_tokens=task.max_output_tokens
            )
            attempts.usage += Usage(
                response_ids=(chat.completion_id,), total_tokens=chat.total_tokens
            )
            return chat.text
        response = await self._miromind.respond(
            self._access,
            prompt=f"{task.instructions}\n\n---\n\n{prompt}",
            agent=task.agent,
            max_output_tokens=task.max_output_tokens,
            idempotency_key=idempotency_key,
            on_step=record,
        )
        attempts.usage += Usage(
            response_ids=(response.response_id,),
            total_tokens=response.total_tokens,
            reasoning_tokens=response.reasoning_tokens,
            num_search_queries=response.num_search_queries,
            cost_usd=response.cost_usd,
        )
        # Steps still open when the stream ended were never emitted; keep them.
        attempts.steps.extend(s for s in response.steps if s not in attempts.steps)
        return response.text

    @staticmethod
    def _failed(
        reason: Literal["timeout", "unparseable", "request_error"],
        exc: Exception,
        engine: Engine,
        attempts: _Attempts,
    ) -> Failed:
        usage = attempts.usage
        response_id = getattr(exc, "response_id", None)
        if response_id and response_id not in usage.response_ids:
            usage += Usage(response_ids=(response_id,))
        return Failed(reason, str(exc), engine, usage, tuple(attempts.steps))


class Transports:
    """Process-wide provider clients. Open once; hand out a `Llm` per job."""

    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self.miromind = MiroMind(http, settings)
        self.deepseek = DeepSeek(http, settings) if settings.cheap_llm_api_key else None

    @classmethod
    @asynccontextmanager
    async def open(cls, settings: Settings) -> AsyncIterator[Transports]:
        async with httpx.AsyncClient() as http:
            yield cls(http, settings)

    def for_job(self, access: MiroMindAccess) -> Llm:
        return Llm(miromind=self.miromind, deepseek=self.deepseek, access=access)
