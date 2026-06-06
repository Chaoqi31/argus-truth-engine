"""Orchestrator publishes lifecycle + step + finding events to the TraceBus."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

from argus.config import Settings
from argus.orchestrator import audit_pdf
from argus.orchestrator.entry import audit_text
from argus.trace_bus.in_process import InProcessBus
from tests._helpers.mock_miromind import StreamRouter, completed, msg, tool

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"


def _planner_json() -> str:
    return json.dumps(
        {
            "claims": [
                {
                    "id": "c1",
                    "text": "Smith (2021) X.",
                    "page": 1,
                    "span": [0, 16],
                    "type": "citation",
                    "importance": "high",
                    "extracted_metadata": {"authors": ["Smith"], "year": 2021},
                }
            ]
        }
    )


def _verifier_json() -> str:
    return json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.9,
            "summary": "No record.",
            "why_wrong": "Paper does not exist in any academic database.",
            "correct_information": None,
            "evidence": [
                {"source_type": "crossref", "url": "https://api.crossref.org/x", "snippet": "{}"}
            ],
            "reasoning_chain": [
                {
                    "action": "search_crossref",
                    "observation": "0 results",
                    "reasoning": "No matching paper found.",
                }
            ],
        }
    )


def _reporter_json() -> str:
    return json.dumps(
        {"executive_summary_md": "**1 issue**.", "ranked_finding_ids": []}
    )


def _planner_two_json() -> str:
    return json.dumps(
        {
            "claims": [
                {
                    "id": "c1",
                    "text": "Acme revenue was $10 billion in 2099.",
                    "page": 1,
                    "span": [0, 37],
                    "type": "numerical_data",
                    "importance": "high",
                    "extracted_metadata": {},
                },
                {
                    "id": "c2",
                    "text": "Acme was founded in 1901.",
                    "page": 1,
                    "span": [38, 63],
                    "type": "qualitative",
                    "importance": "medium",
                    "extracted_metadata": {},
                },
            ]
        }
    )


class _StalledVerifierClient:
    def __init__(self) -> None:
        self._rid_to_agent: dict[str, str] = {}
        self._counter = 0

    async def submit_background(
        self,
        *,
        input: str | list[dict[str, Any]],
        instructions: str | None = None,
        max_output_tokens: int | None = None,
        metadata: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        self._counter += 1
        agent = (metadata or {}).get("agent", "unknown")
        rid = f"resp_{agent}_{self._counter}"
        self._rid_to_agent[rid] = agent
        return rid

    async def stream(self, rid: str, after: int = 0) -> AsyncIterator[Any]:
        agent = self._rid_to_agent[rid]
        if agent == "planner":
            yield msg(_planner_two_json())
            yield completed(tokens=80)
            return
        if agent == "consistency":
            yield msg(json.dumps({"contradictions": [], "logical_flaws": []}))
            yield completed(tokens=20)
            return
        if agent == "reporter":
            yield msg(_reporter_json())
            yield completed(tokens=20)
            return
        if agent == "unified_verifier":
            await asyncio.sleep(60)
            return
        raise AssertionError(f"unexpected agent={agent!r}")


async def test_audit_pdf_publishes_lifecycle_and_step_events(tmp_path: Path) -> None:
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "unified_verifier",
        [tool("web_search", {"q": "Smith"}, 2), msg(_verifier_json()), completed(tokens=60)],
    )
    router.add(
        "consistency",
        [msg(json.dumps({"contradictions": []})), completed(tokens=20)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
        trace_bus=bus,
    )

    # After audit_pdf returns, subscribe and replay history.
    async with bus.subscribe(job.id) as sub:
        history = [ev async for ev in sub.iter_history()]

    kinds = [ev.kind for ev in history]
    assert kinds[0] == "started"
    assert kinds[-1] == "finished"
    assert "step" in kinds
    assert "finding" in kinds

    # Sequence numbers strictly increasing, starting at 1.
    seqs = [ev.sequence for ev in history]
    assert seqs == sorted(seqs)
    assert seqs[0] == 1
    assert len(set(seqs)) == len(seqs)

    # Every event belongs to the right job.
    assert all(ev.job_id == job.id for ev in history)


async def test_audit_text_publishes_stage_and_claim_lifecycle_events(
    tmp_path: Path,
) -> None:
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "unified_verifier",
        [
            tool("web_search", {"q": "Smith fabricated citation"}, 2),
            msg(_verifier_json(), seq=3),
            completed(tokens=60),
        ],
    )
    router.add(
        "consistency",
        [msg(json.dumps({"contradictions": []})), completed(tokens=20)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await audit_text(
        text="Smith (2021) X. This citation is included for audit testing.",
        output_path=out,
        settings=Settings(
            miromind_api_key="x",
            miromind_retry_base_delay_s=0.001,
            cache_enabled=False,
        ),
        client=router.make_client(),
        budget_usd=10.0,
        trace_bus=bus,
        job_id="job_live_contract",
        auto_review=True,
    )

    async with bus.subscribe(job.id) as sub:
        history = [ev async for ev in sub.iter_history()]

    stage_events = [ev for ev in history if ev.kind == "stage"]
    finished_stage_keys = [
        ev.payload["key"] for ev in stage_events if ev.payload["status"] == "finished"
    ]
    assert finished_stage_keys[:5] == [
        "parse",
        "planner",
        "atomizer",
        "checkworthiness",
        "review_gate",
    ]
    assert set(finished_stage_keys) >= {
        "verify",
        "consistency",
        "confidence",
        "reporter",
    }
    claim_events = [ev for ev in history if ev.kind == "claim"]
    assert [ev.payload["status"] for ev in claim_events] == ["started", "finished"]
    assert claim_events[0].payload["text"] == "Smith (2021) X."


async def test_stalled_verifier_stream_times_out_and_finishes_job(
    tmp_path: Path,
) -> None:
    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await asyncio.wait_for(
        audit_text(
            text=(
                "Acme revenue was $10 billion in 2099. "
                "Acme was founded in 1901."
            ),
            output_path=out,
            settings=Settings(
                miromind_api_key="x",
                cheap_llm_api_key="",
                cache_enabled=False,
                miromind_retry_base_delay_s=0.001,
                miromind_response_timeout_s=0.05,
            ),
            client=_StalledVerifierClient(),
            budget_usd=10.0,
            trace_bus=bus,
            job_id="job_stalled_verifier",
            auto_review=True,
        ),
        timeout=1.0,
    )

    assert job.status == "done"
    verifier_findings = [f for f in job.findings if f.agent == "UnifiedVerifier"]
    assert len(verifier_findings) == 2
    assert {f.verdict.value for f in verifier_findings} == {"uncertain"}

    async with bus.subscribe("job_stalled_verifier") as sub:
        history = [ev async for ev in sub.iter_history()]
    assert history[-1].kind == "finished"
    heartbeat_events = [ev for ev in history if ev.kind == "heartbeat"]
    assert heartbeat_events
    assert heartbeat_events[0].payload["stage"] == "verify"
    assert history[-1].payload["partial_coverage"] is False
    assert history[-1].payload["n_timeout_findings"] == 2


async def test_audit_pdf_publishes_native_verifier_steps_before_finding(
    tmp_path: Path,
) -> None:
    """A live audit should stream native MiroMind tool steps, not only final summaries."""
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "unified_verifier",
        [
            tool("web_search", {"q": "Smith fabricated citation"}, 2),
            msg(_verifier_json(), seq=3),
            completed(tokens=60),
        ],
    )
    router.add(
        "consistency",
        [msg(json.dumps({"contradictions": []})), completed(tokens=20)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
        trace_bus=bus,
        job_id="job_native_steps",
    )

    async with bus.subscribe(job.id) as sub:
        history = [ev async for ev in sub.iter_history()]

    native_steps = [
        ev for ev in history
        if ev.kind == "step" and isinstance(ev.payload.get("step"), dict)
    ]
    assert native_steps, [ev.payload for ev in history if ev.kind == "step"]
    first_native = native_steps[0].payload["step"]
    assert first_native["type"] == "web_search"
    assert first_native["summary"] == "search: Smith fabricated citation"

    first_finding_seq = next(ev.sequence for ev in history if ev.kind == "finding")
    assert native_steps[0].sequence < first_finding_seq


async def test_audit_pdf_honours_caller_supplied_job_id(tmp_path: Path) -> None:
    """Regression: HTTP API needs submit-time id == orchestrator event job_id.

    Without this, the WebSocket subscriber (which sees the POST /jobs job_id)
    finds zero events because the orchestrator publishes under its own
    auto-generated id.
    """
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "unified_verifier",
        [msg(_verifier_json()), completed(tokens=60)],
    )
    router.add(
        "consistency",
        [msg(json.dumps({"contradictions": []})), completed(tokens=20)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
        trace_bus=bus,
        job_id="job_caller_supplied",
    )
    assert job.id == "job_caller_supplied"

    async with bus.subscribe("job_caller_supplied") as sub:
        history = [ev async for ev in sub.iter_history()]
    assert len(history) >= 2  # at least started + finished
    assert all(ev.job_id == "job_caller_supplied" for ev in history)


async def test_audit_pdf_traps_unexpected_exception_and_publishes_failed(
    tmp_path: Path,
) -> None:
    """Regression: a runtime error mid-graph must still emit a 'failed' WS event.

    Live MiroMind runs occasionally produce httpx errors that bubble out of an
    agent node after retries exhaust. Without this trap, audit_pdf raised, the
    JobRunner only marked an internal failure, and WS subscribers hung waiting
    for a terminal event that never came.
    """
    # Force the orchestrator into the unhandled-exception branch by making the
    # MiroMind client raise on its very first call (mirrors a real httpx
    # connection error that survives the retry layer).
    fake_client = AsyncMock()
    fake_client.submit_background = AsyncMock(
        side_effect=RuntimeError("upstream peer closed"),
    )

    bus = InProcessBus()
    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=fake_client,
        budget_usd=10.0,
        trace_bus=bus,
        job_id="job_exc_test",
    )
    assert job.status == "failed"
    assert job.id == "job_exc_test"

    async with bus.subscribe("job_exc_test") as sub:
        history = [ev async for ev in sub.iter_history()]
    kinds = [ev.kind for ev in history]
    assert kinds[0] == "started"
    assert kinds[-1] == "failed"
    assert "RuntimeError" in (history[-1].payload.get("reason") or "")


async def test_audit_pdf_no_bus_is_no_op(tmp_path: Path) -> None:
    """Omitting trace_bus must not raise; existing callers are unaffected."""
    router = StreamRouter()
    router.add("planner", [msg(_planner_json()), completed(tokens=80)])
    router.add(
        "unified_verifier",
        [msg(_verifier_json()), completed(tokens=60)],
    )
    router.add(
        "consistency",
        [msg(json.dumps({"contradictions": []})), completed(tokens=20)],
    )
    router.add("reporter", [msg(_reporter_json()), completed(tokens=20)])

    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x", miromind_retry_base_delay_s=0.001),
        client=router.make_client(),
        budget_usd=10.0,
    )
    assert job.id
