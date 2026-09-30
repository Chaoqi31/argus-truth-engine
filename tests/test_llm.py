"""The LLM gateway over the real HTTP clients, against the scripted fake server."""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from argus.agents.unified_verifier import (
    SYSTEM_PROMPT,
    UnifiedVerifierOutput,
    build_verifier_input,
)
from argus.llm import Answered, Failed, Llm, Route, Task, Transports
from argus.llm.miromind import MiroMindAccess, price
from argus.llm.output import OutputError, parse_output
from argus.models.domain import FindingVerdict, Step, StepType
from tests.fake_llm import S5, S6, FakeLLM
from tests.golden import audit_settings, fake_llm_server

VERIFY = Task(
    agent="unified_verifier",
    route=Route.DEEP_RESEARCH,
    instructions=SYSTEM_PROMPT,
    output=UnifiedVerifierOutput,
    max_output_tokens=6000,
)


class _Pair(BaseModel):
    type: str
    importance: str


def test_parse_output_repairs_common_llm_damage() -> None:
    assert parse_output('{"type":"citation""importance":"high"}', _Pair) == _Pair(
        type="citation", importance="high"
    )
    fenced = '```json\n[{"type":"citation","importance":"high",}]\n```'
    assert parse_output(fenced, _Pair) == _Pair(type="citation", importance="high")
    with pytest.raises(OutputError):
        parse_output("Sorry, I could not finish the research.", _Pair)
    with pytest.raises(OutputError, match="importance"):
        parse_output('{"type":"citation"}', _Pair)


def test_price_is_list_price_with_promo_plus_search_fees() -> None:
    cost = price(
        model="mirothinker-1-7-deepresearch",
        input_tokens=1_000_000,
        output_tokens=100_000,
        web_searches=2,
    )
    assert cost == pytest.approx((4.00 + 2.50) * 0.75 + 0.10)


async def _ask(
    fake: FakeLLM,
    task: Task[UnifiedVerifierOutput],
    claim: str,
    *,
    cheap_llm: bool = False,
    **overrides: object,
) -> tuple[Answered[UnifiedVerifierOutput] | Failed, list[Step]]:
    streamed: list[Step] = []

    async def on_step(step: Step) -> None:
        streamed.append(step)

    with fake_llm_server(fake) as (base_url, _):
        settings = audit_settings(base_url, cheap_llm=cheap_llm, **overrides)
        async with Transports.open(settings) as transports:
            llm = transports.for_job(MiroMindAccess.from_settings(settings))
            answer = await llm.ask(task, build_verifier_input(claim, "", ""), on_step=on_step)
    return answer, streamed


async def test_ask_streams_steps_and_prices_the_response() -> None:
    answer, streamed = await _ask(FakeLLM(), VERIFY, S5)

    assert isinstance(answer, Answered)
    assert answer.output.verdict == FindingVerdict.INACCURATE
    assert [s.type for s in streamed] == [StepType.THINKING, StepType.WEB_SEARCH]
    assert list(answer.steps) == streamed
    assert streamed[1].content["result"]
    assert len(answer.usage.response_ids) == 1
    assert answer.usage.cost_usd == pytest.approx(
        price(
            model="mirothinker-1-7-deepresearch",
            input_tokens=1000,
            output_tokens=500,
            web_searches=2,
        )
    )


async def test_ask_repairs_broken_output_once() -> None:
    fake = FakeLLM(malformed_once=frozenset({S5}))
    answer, _ = await _ask(fake, VERIFY, S5)

    assert isinstance(answer, Answered)
    assert answer.output.verdict == FindingVerdict.INACCURATE
    assert len(answer.usage.response_ids) == 2
    assert len(answer.steps) == 4


async def test_ask_reports_output_that_never_parses() -> None:
    answer, _ = await _ask(FakeLLM(), VERIFY, S6)

    assert isinstance(answer, Failed)
    assert answer.reason == "unparseable"
    assert len(answer.usage.response_ids) == 2
    assert answer.usage.cost_usd > 0


async def test_ask_times_out_and_cancels_the_response() -> None:
    fake = FakeLLM(stalled=frozenset({S5}))
    answer, streamed = await _ask(fake, VERIFY, S5, miromind_response_timeout_s=0.5)

    assert isinstance(answer, Failed)
    assert answer.reason == "timeout"
    assert fake.cancelled == list(answer.usage.response_ids)
    assert list(answer.steps) == streamed


async def test_ask_resumes_a_dropped_stream_where_it_broke() -> None:
    fake = FakeLLM(dropped_once=frozenset({S5}))
    answer, _ = await _ask(fake, VERIFY, S5)

    assert isinstance(answer, Answered)
    assert answer.output.verdict == FindingVerdict.INACCURATE
    afters = [after for _, after in fake.stream_requests]
    assert len(afters) == 2
    assert afters[0] == 0 < afters[1]


async def test_ask_retries_a_failing_provider_then_reports_it() -> None:
    fake = FakeLLM(failing=frozenset({"verifier"}))
    answer, _ = await _ask(fake, VERIFY, S5, miromind_retry_attempts=3)

    assert isinstance(answer, Failed)
    assert answer.reason == "request_error"
    assert "500" in answer.detail
    assert len(fake.requests) == 3


async def test_text_tasks_run_on_deepseek_when_it_is_configured() -> None:
    text_task = Task(
        agent="unified_verifier",
        route=Route.TEXT,
        instructions=SYSTEM_PROMPT,
        output=UnifiedVerifierOutput,
        max_output_tokens=6000,
    )
    answer, streamed = await _ask(FakeLLM(), text_task, S5, cheap_llm=True)

    assert isinstance(answer, Answered)
    assert answer.engine == "deepseek"
    assert streamed == []
    assert answer.usage.cost_usd == 0.0


def test_deepseek_only_tasks_cannot_run_without_deepseek() -> None:
    llm = Llm(miromind=None, deepseek=None, access=None)  # type: ignore[arg-type]
    only = Task(
        agent="atomizer",
        route=Route.DEEPSEEK_ONLY,
        instructions="",
        output=_Pair,
        max_output_tokens=10,
    )
    assert llm.engine(only) is None
    assert llm.engine(VERIFY) == "miromind"
