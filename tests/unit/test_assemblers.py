"""Pin behavior of pure assemblers — these are now stable extraction points."""
from argus.agents.base import StreamCollection
from argus.agents.consistency import ConsistencyOutput, ContradictionPair, LogicalFlaw
from argus.agents.unified_verifier import (
    CorrectedInfoOut,
    EvidenceOut,
    UnifiedVerifierOutput,
)
from argus.models.domain import Claim, ClaimType, FindingVerdict, Severity, Step, StepType
from argus.orchestrator.assemblers import (
    _build_trace,
    _contradictions_to_findings,
    _logical_flaws_to_findings,
    _make_unified_finding,
)


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
        # Two sources so the >=2-source floor does not downgrade this verdict.
        evidence=[
            EvidenceOut(source_type="company_filing", url="https://sec.gov/a", snippet="."),
            EvidenceOut(source_type="web_page", url="https://example.com/b", snippet="."),
        ],
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


def test_logical_flaws_to_findings_maps_unsupported_inference():
    parsed = ConsistencyOutput(
        contradictions=[],
        logical_flaws=[
            LogicalFlaw(
                claim_id="claim_7",
                type="unsupported_inference",
                severity=Severity.MAJOR,
                confidence=0.82,
                summary="Concludes margins will rise from a single analyst note.",
                missing="Independent margin guidance confirming the uplift.",
            )
        ],
    )
    findings = _logical_flaws_to_findings(
        job_id="job_x", parsed=parsed, trace_id="trace_abc"
    )
    assert len(findings) == 1
    f = findings[0]
    assert f.verdict == FindingVerdict.UNSUPPORTED_INFERENCE
    assert f.claim_id == "claim_7"
    assert f.agent == "Consistency"
    assert f.severity == Severity.MAJOR
    assert f.confidence == 0.82
    assert f.summary == "Concludes margins will rise from a single analyst note."
    # `missing` surfaces through why_wrong so the UI shows what is needed.
    assert f.why_wrong == "Independent margin guidance confirming the uplift."
    assert f.evidence_ids == []
    assert f.reasoning_trace_id == "trace_abc"
    assert f.related_finding_ids == []


def test_logical_flaws_to_findings_maps_overreach():
    parsed = ConsistencyOutput(
        contradictions=[],
        logical_flaws=[
            LogicalFlaw(
                claim_id="claim_9",
                type="overreach",
                severity=Severity.MINOR,
                confidence=0.6,
                summary="Claims global leadership from a one-region survey.",
                missing="Global market-share data beyond the single region.",
            )
        ],
    )
    findings = _logical_flaws_to_findings(
        job_id="job_x", parsed=parsed, trace_id="trace_def"
    )
    assert len(findings) == 1
    f = findings[0]
    assert f.verdict == FindingVerdict.OVERREACH
    assert f.claim_id == "claim_9"
    assert f.why_wrong == "Global market-share data beyond the single region."
    assert f.evidence_ids == []


def test_logical_flaws_to_findings_empty_returns_no_findings():
    parsed = ConsistencyOutput(contradictions=[], logical_flaws=[])
    assert _logical_flaws_to_findings(
        job_id="job_x", parsed=parsed, trace_id="trace_x"
    ) == []


def test_contradictions_to_findings_unchanged():
    """Regression: contradiction pairs still produce two cross-linked findings."""
    parsed = ConsistencyOutput(
        contradictions=[
            ContradictionPair(
                claim_a_id="c1",
                claim_b_id="c2",
                severity=Severity.CRITICAL,
                confidence=0.95,
                summary="Margin 32% vs 28%.",
            )
        ],
    )
    findings = _contradictions_to_findings(
        job_id="job_x", parsed=parsed, trace_id="trace_c"
    )
    assert len(findings) == 2
    a, b = findings
    assert a.verdict == FindingVerdict.CONTRADICTION
    assert b.verdict == FindingVerdict.CONTRADICTION
    assert a.claim_id == "c1" and b.claim_id == "c2"
    assert a.severity == Severity.CRITICAL
    assert a.related_finding_ids == [b.id]
    assert b.related_finding_ids == [a.id]
    assert a.evidence_ids == [] and b.evidence_ids == []
    assert a.reasoning_trace_id == "trace_c"


def _ev(url: str) -> EvidenceOut:
    return EvidenceOut(source_type="web_page", url=url, snippet="...")


def _trace_for() -> object:
    return _build_trace(
        job_id="job_x",
        claim_id="claim_1",
        agent="UnifiedVerifier",
        stream=_minimal_stream(),
    )


def test_make_unified_finding_downgrades_when_fewer_than_two_sources():
    """A non-uncertain verdict backed by <2 evidence is downgraded to uncertain."""
    payload = UnifiedVerifierOutput(
        verdict=FindingVerdict.FABRICATED,
        confidence=0.92,
        summary="No record of this paper anywhere.",
        why_wrong="Paper does not exist in any academic database.",
        correct_information=CorrectedInfoOut(value="N/A", source="Crossref"),
        evidence=[_ev("https://api.crossref.org/x")],
        reasoning_chain=[],
    )
    finding, evs = _make_unified_finding(
        job_id="job_x", claim=_sample_claim(), parsed=payload, trace=_trace_for()
    )
    assert finding.verdict == FindingVerdict.UNCERTAIN
    assert finding.correct_information is None
    assert finding.why_wrong is None
    assert finding.confidence <= 0.5
    assert "Downgraded" in finding.summary
    # The single evidence record is still attached for display.
    assert len(evs) == 1
    assert finding.evidence_ids == [evs[0].id]


def test_make_unified_finding_caps_confidence_at_existing_when_lower():
    """Downgrade takes min(original, 0.5) — a low original stays low."""
    payload = UnifiedVerifierOutput(
        verdict=FindingVerdict.INACCURATE,
        confidence=0.3,
        summary="Number looks off.",
        why_wrong="The figure is wrong.",
        correct_information=None,
        evidence=[_ev("https://example.com/a")],
        reasoning_chain=[],
    )
    finding, _evs = _make_unified_finding(
        job_id="job_x", claim=_sample_claim(), parsed=payload, trace=_trace_for()
    )
    assert finding.verdict == FindingVerdict.UNCERTAIN
    assert finding.confidence == 0.3


def test_make_unified_finding_keeps_verdict_with_two_sources():
    """Two independent sources → verdict preserved, no downgrade."""
    payload = UnifiedVerifierOutput(
        verdict=FindingVerdict.OK,
        confidence=0.85,
        summary="Confirmed by two filings.",
        why_wrong=None,
        correct_information=None,
        evidence=[_ev("https://a.example/x"), _ev("https://b.example/y")],
        reasoning_chain=[],
    )
    finding, evs = _make_unified_finding(
        job_id="job_x", claim=_sample_claim(), parsed=payload, trace=_trace_for()
    )
    assert finding.verdict == FindingVerdict.OK
    assert finding.confidence == 0.85
    assert "Downgraded" not in finding.summary
    assert len(evs) == 2


def test_make_unified_finding_uncertain_with_zero_sources_not_double_downgraded():
    """An already-uncertain verdict with no evidence is left untouched."""
    payload = UnifiedVerifierOutput(
        verdict=FindingVerdict.UNCERTAIN,
        confidence=0.4,
        summary="Could not verify — paywalled source.",
        why_wrong=None,
        correct_information=None,
        evidence=[],
        reasoning_chain=[],
    )
    finding, evs = _make_unified_finding(
        job_id="job_x", claim=_sample_claim(), parsed=payload, trace=_trace_for()
    )
    assert finding.verdict == FindingVerdict.UNCERTAIN
    assert finding.confidence == 0.4
    assert "Downgraded" not in finding.summary
    assert evs == []
