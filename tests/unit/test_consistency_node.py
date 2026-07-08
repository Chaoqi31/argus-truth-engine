from argus.models.domain import Finding, FindingVerdict
from argus.orchestrator.nodes.consistency import _drop_redundant_logical_findings


def _finding(agent: str, verdict: FindingVerdict, claim_id: str) -> Finding:
    return Finding(
        id=f"{agent}_{verdict}_{claim_id}",
        job_id="job_x",
        claim_id=claim_id,
        agent=agent,
        verdict=verdict,
        confidence=0.9,
        summary="s",
        reasoning_trace_id="trace_x",
    )


def test_drop_redundant_logical_findings_keeps_new_cross_claim_issues() -> None:
    existing = [_finding("UnifiedVerifier", FindingVerdict.INACCURATE, "a_1")]
    duplicate = _finding("Consistency", FindingVerdict.UNSUPPORTED_INFERENCE, "a_1")
    contradiction = _finding("Consistency", FindingVerdict.CONTRADICTION, "a_1")
    uncovered = _finding("Consistency", FindingVerdict.OVERREACH, "a_2")

    kept = _drop_redundant_logical_findings(existing, [duplicate, contradiction, uncovered])

    assert kept == [contradiction, uncovered]


def test_drop_redundant_logical_findings_keeps_uncertain_claims() -> None:
    existing = [_finding("UnifiedVerifier", FindingVerdict.UNCERTAIN, "a_1")]
    logical = _finding("Consistency", FindingVerdict.UNSUPPORTED_INFERENCE, "a_1")

    kept = _drop_redundant_logical_findings(existing, [logical])

    assert kept == [logical]
