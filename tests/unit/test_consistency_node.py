from argus.audit.consistency import without_redundant
from argus.models.domain import Finding, FindingVerdict


def _finding(agent: str, verdict: FindingVerdict, claim_id: str) -> Finding:
    return Finding(
        id=f"{agent}_{verdict}_{claim_id}",
        claim_id=claim_id,
        agent=agent,
        verdict=verdict,
        confidence=0.9,
        summary="s",
        reasoning_trace_id="trace_x",
    )


def test_drop_redundant_logical_findings_keeps_new_cross_claim_issues() -> None:
    existing = [_finding("verifier", FindingVerdict.INACCURATE, "a_1")]
    duplicate = _finding("consistency", FindingVerdict.UNSUPPORTED_INFERENCE, "a_1")
    contradiction = _finding("consistency", FindingVerdict.CONTRADICTION, "a_1")
    uncovered = _finding("consistency", FindingVerdict.OVERREACH, "a_2")

    kept = without_redundant(existing, [duplicate, contradiction, uncovered])

    assert kept == [contradiction, uncovered]


def test_drop_redundant_logical_findings_keeps_uncertain_claims() -> None:
    existing = [_finding("verifier", FindingVerdict.UNCERTAIN, "a_1")]
    logical = _finding("consistency", FindingVerdict.UNSUPPORTED_INFERENCE, "a_1")

    kept = without_redundant(existing, [logical])

    assert kept == [logical]
