"""The LLM gateway over the real HTTP clients, against the scripted fake server."""

from __future__ import annotations

import pytest
from pydantic import BaseModel, SecretStr

from argus.agents.unified_verifier import VERIFY, UnifiedVerifierOutput, build_verifier_input
from argus.llm import Answered, Failed, Llm, Route, Task, Transports
from argus.llm.miromind import MiroMindAccess, MiroMindError, _Steps, price
from argus.llm.output import OutputError, parse_output
from argus.models.domain import FindingVerdict, Step, StepType
from tests.fake_llm import S5, S6, FakeLLM
from tests.golden import audit_settings, fake_llm_server


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


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        ("mirothinker-1-7-deepresearch", (4.00 + 2.50) * 0.75 + 0.10),
        ("mirothinker-1-7-deepresearch-mini", (1.25 + 1.00) * 0.75 + 0.10),
    ],
)
def test_price_is_list_price_with_promo_plus_search_fees(model: str, expected: float) -> None:
    cost = price(model=model, input_tokens=1_000_000, output_tokens=100_000, web_searches=2)
    assert cost == pytest.approx(expected)


async def _ask(
    fake: FakeLLM,
    task: Task[UnifiedVerifierOutput],
    claim: str,
    *,
    cheap_llm: bool = False,
    api_key: str = "fake",
    idempotency_key: str | None = None,
    **overrides: object,
) -> tuple[Answered[UnifiedVerifierOutput] | Failed, list[Step]]:
    streamed: list[Step] = []

    with fake_llm_server(fake) as (base_url, _):
        settings = audit_settings(base_url, cheap_llm=cheap_llm, **overrides)
        async with Transports(settings) as transports:
            llm = transports.for_job(
                MiroMindAccess(api_key=SecretStr(api_key), model=settings.miromind_model)
            )
            answer = await llm.ask(
                task,
                build_verifier_input(claim, "", ""),
                on_step=streamed.append,
                idempotency_key=idempotency_key,
            )
    return answer, streamed


@pytest.mark.parametrize(
    "model", ["mirothinker-1-7-deepresearch", "mirothinker-1-7-deepresearch-mini"]
)
async def test_ask_streams_steps_and_prices_the_response(model: str) -> None:
    fake = FakeLLM()
    answer, streamed = await _ask(fake, VERIFY, S5, miromind_model=model)

    assert isinstance(answer, Answered)
    assert answer.output.verdict == FindingVerdict.INACCURATE
    assert [s.type for s in streamed] == [StepType.THINKING, StepType.WEB_SEARCH]
    assert streamed[1].content["result"]
    assert len(answer.usage.response_ids) == 1
    assert fake.requests[0]["model"] == model
    assert answer.usage.cost_usd == pytest.approx(
        price(
            model=model,
            input_tokens=1000,
            output_tokens=500,
            web_searches=2,
        )
    )


def _item(kind: str, seq: int, item: dict[str, object]) -> dict[str, object]:
    return {"type": f"response.output_item.{kind}", "sequence_number": seq, "item": item}


def test_steps_come_out_in_the_order_their_items_began() -> None:
    search = {"type": "tool_call", "id": "t1", "name": "google_search", "arguments": "{}"}
    steps = _Steps("verifier")
    thought = {"type": "response.reasoning_text.delta", "sequence_number": 2, "delta": "hm"}

    assert steps.feed(_item("added", 1, search)) == []
    assert steps.feed(thought) == []
    assert steps.feed(_item("done", 3, {"type": "reasoning", "id": "r1"})) == []
    released = steps.feed(_item("done", 4, {**search, "status": "completed"}))

    assert [s.type for s in released] == [StepType.WEB_SEARCH, StepType.THINKING]
    assert steps.feed({"type": "response.completed", "sequence_number": 5}) == []


def test_steps_behind_a_call_that_never_completes_come_out_at_the_end() -> None:
    steps = _Steps("verifier")
    steps.feed(_item("added", 1, {"type": "tool_call", "id": "t1", "name": "google_search"}))
    steps.feed({"type": "response.reasoning_text.delta", "sequence_number": 2, "delta": "hm"})
    steps.feed(_item("done", 3, {"type": "reasoning", "id": "r1"}))

    assert [s.type for s in steps.flush()] == [StepType.THINKING]


async def test_ask_repairs_broken_output_once_under_a_fresh_idempotency_key() -> None:
    fake = FakeLLM(malformed_once=frozenset({S5}))
    answer, streamed = await _ask(fake, VERIFY, S5, idempotency_key="k1")

    assert isinstance(answer, Answered)
    assert answer.output.verdict == FindingVerdict.INACCURATE
    assert len(answer.usage.response_ids) == 2
    assert len(streamed) == 4
    assert [r["idempotency_key"] for r in fake.requests] == ["k1", "k1:repair"]


async def test_ask_reports_output_that_never_parses() -> None:
    answer, _ = await _ask(FakeLLM(), VERIFY, S6)

    assert isinstance(answer, Failed)
    assert answer.reason == "unparseable"
    assert len(answer.usage.response_ids) == 2
    assert answer.usage.cost_usd > 0


async def test_ask_times_out_and_cancels_the_response() -> None:
    fake = FakeLLM(stalled=frozenset({S5}))
    answer, _ = await _ask(fake, VERIFY, S5, miromind_response_timeout_s=0.5)

    assert isinstance(answer, Failed)
    assert answer.reason == "timeout"
    assert fake.cancelled == list(answer.usage.response_ids)


async def test_ask_resumes_a_dropped_stream_where_it_broke() -> None:
    fake = FakeLLM(dropped={S5: 1})
    answer, _ = await _ask(fake, VERIFY, S5)

    assert isinstance(answer, Answered)
    assert answer.output.verdict == FindingVerdict.INACCURATE
    afters = [after for _, after in fake.stream_requests]
    assert len(afters) == 2
    assert afters[0] == 0 < afters[1]


async def test_ask_gives_up_on_a_stream_that_keeps_dropping() -> None:
    fake = FakeLLM(dropped={S5: 10})
    answer, _ = await _ask(fake, VERIFY, S5)

    assert isinstance(answer, Failed)
    assert answer.reason == "request_error"
    assert len(fake.stream_requests) == 4


async def test_ask_reports_a_response_that_failed_upstream() -> None:
    fake = FakeLLM(erroring=frozenset({S5}))
    answer, _ = await _ask(fake, VERIFY, S5)

    assert isinstance(answer, Failed)
    assert answer.reason == "request_error"
    assert "scripted failure" in answer.detail
    assert len(fake.stream_requests) == 1


async def test_ask_retries_a_failing_provider_then_reports_it() -> None:
    fake = FakeLLM(failing=frozenset({"verifier"}))
    answer, _ = await _ask(fake, VERIFY, S5, miromind_retry_attempts=3)

    assert isinstance(answer, Failed)
    assert answer.reason == "request_error"
    assert "500" in answer.detail
    assert len(fake.requests) == 3


async def test_ask_does_not_retry_a_rejected_key() -> None:
    fake = FakeLLM(rejected_keys=frozenset({"sk_revoked"}))
    answer, _ = await _ask(fake, VERIFY, S5, api_key="sk_revoked")

    assert isinstance(answer, Failed)
    assert answer.reason == "request_error"
    assert "401" in answer.detail
    assert len(fake.requests) == 1


async def test_check_key_probes_with_the_given_key_and_cancels_the_probe() -> None:
    fake = FakeLLM(rejected_keys=frozenset({"sk_revoked"}))
    with fake_llm_server(fake) as (base_url, _):
        settings = audit_settings(base_url, cheap_llm=False)
        async with Transports(settings) as transports:
            model = settings.miromind_model
            response_id = await transports.miromind.check_key(
                MiroMindAccess(api_key=SecretStr("sk_live"), model=model)
            )
            with pytest.raises(MiroMindError, match="401"):
                await transports.miromind.check_key(
                    MiroMindAccess(api_key=SecretStr("sk_revoked"), model=model)
                )

    assert [r["api_key"] for r in fake.requests] == ["sk_live", "sk_revoked"]
    assert fake.cancelled == [response_id]


async def test_text_tasks_run_on_deepseek_when_it_is_configured() -> None:
    text_task = Task(
        agent="unified_verifier",
        route=Route.TEXT,
        instructions=VERIFY.instructions,
        output=UnifiedVerifierOutput,
        max_output_tokens=6000,
    )
    fake = FakeLLM()
    answer, streamed = await _ask(fake, text_task, S5, cheap_llm=True)

    assert isinstance(answer, Answered)
    assert [r["api"] for r in fake.requests] == ["chat"]
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
    assert not llm.can_run(only)
    assert llm.can_run(VERIFY)
    assert llm.engine(VERIFY) == "miromind"
