"""Pin behavior of pure assemblers — these are now stable extraction points."""
from argus.agents.base import StreamCollection
from argus.agents.unified_verifier import UnifiedVerifierOutput
from argus.models.domain import Claim, ClaimType, FindingVerdict, Step, StepType
from argus.orchestrator.assemblers import _build_trace, _make_unified_finding


def _minimal_stream() -> StreamCollection:
    """Minimal StreamCollection stub — no I/O, no network."""
    return StreamCollection(
        response_id="resp_test_000",
        final_text="",
        steps=[],
        total_tokens=0,
        input_tokens=0,
        output_tokens=0,
        reasoning_tokens=0,
        num_search_queries=0,
    )


def _sample_claim() -> Claim:
    # Claim uses `page` (int) and `span` (tuple[int,int]), not
    # page_number/span_start/span_end.
    return Claim(
        id="claim_1",
        text="Acme Corp Q3 revenue grew 42%.",
        type=ClaimType.NUMERICAL_DATA,
        importance="high",
        span=(0, 30),
        page=1,
    )


def test_make_unified_finding_preserves_verdict_and_links_trace():
    payload = UnifiedVerifierOutput(
        verdict=FindingVerdict.OK,
        confidence=0.9,
        summary="Verified against Acme 10-Q filing.",
        why_wrong=None,
        correct_information=None,
        evidence=[],
        reasoning_chain=[],
    )
    trace = _build_trace(
        job_id="job_x",
        claim_id="claim_1",
        agent="UnifiedVerifier",
        stream=_minimal_stream(),
    )
    finding, _evs = _make_unified_finding(
        job_id="job_x",
        claim=_sample_claim(),
        parsed=payload,
        trace=trace,
    )
    assert finding.claim_id == "claim_1"
    assert finding.verdict == FindingVerdict.OK
    assert finding.reasoning_trace_id == trace.id
    assert finding.confidence == 0.9


def test_build_trace_links_steps_into_sequential_chain():
    # Out-of-order sequences on purpose — _build_trace must sort before linking.
    raw_steps = [
        Step(id="s_c", trace_id="resp_x", sequence=2, type=StepType.MESSAGE, summary="c"),
        Step(id="s_a", trace_id="resp_x", sequence=0, type=StepType.THINKING, summary="a"),
        Step(id="s_b", trace_id="resp_x", sequence=1, type=StepType.WEB_SEARCH, summary="b"),
    ]
    stream = StreamCollection(
        response_id="resp_x",
        final_text="",
        steps=list(raw_steps),
        total_tokens=0,
        input_tokens=0,
        output_tokens=0,
        reasoning_tokens=0,
        num_search_queries=0,
    )

    trace = _build_trace(
        job_id="job_x", claim_id="claim_1", agent="UnifiedVerifier", stream=stream
    )

    # (a) steps come back sorted ascending by sequence
    assert [s.sequence for s in trace.steps] == [0, 1, 2]
    assert [s.id for s in trace.steps] == ["s_a", "s_b", "s_c"]

    # (b) first step has no parent
    assert trace.steps[0].parent_step_id is None

    # (c) each subsequent step points at the previous step's id
    for i in range(1, len(trace.steps)):
        assert trace.steps[i].parent_step_id == trace.steps[i - 1].id

    # (d) original input objects were not mutated in place
    assert all(s.parent_step_id is None for s in raw_steps)
