"""Pin behavior of pure assemblers — these are now stable extraction points."""
from argus.agents.base import StreamCollection
from argus.agents.unified_verifier import UnifiedVerifierOutput
from argus.models.domain import Claim, ClaimType, FindingVerdict
from argus.orchestrator.assemblers import _make_unified_finding, _build_trace


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
