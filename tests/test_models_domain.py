"""Tests for domain models."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from argus.models.domain import (
    Claim,
    ClaimType,
    Evidence,
    EvidenceSource,
    Finding,
    FindingVerdict,
    Severity,
)


def test_claim_round_trip() -> None:
    c = Claim(
        id="claim_001",
        text="According to Tan (2024), supply chains are resilient.",
        page=12,
        span=(0, 52),
        type=ClaimType.CITATION,
        importance="high",
        extracted_metadata={"authors": ["Tan"], "year": 2024},
    )
    payload = c.model_dump_json()
    parsed = Claim.model_validate_json(payload)
    assert parsed == c


def test_claim_rejects_bad_span() -> None:
    with pytest.raises(ValidationError):
        Claim(
            id="x",
            text="hi",
            page=1,
            span=(5, 2),
            type=ClaimType.QUALITATIVE,
            importance="low",
        )


def test_finding_links_to_claim_and_evidences() -> None:
    f = Finding(
        id="f_001",
        job_id="job_x",
        claim_id="claim_001",
        agent="CitationVerifier",
        verdict=FindingVerdict.FABRICATED,
        severity=Severity.MAJOR,
        confidence=0.92,
        summary="No DOI match in Crossref.",
        evidence_ids=["e1", "e2"],
        reasoning_trace_id="t1",
    )
    assert f.confidence == 0.92
    assert "e1" in f.evidence_ids


def test_evidence_url_optional_but_citation_required() -> None:
    e = Evidence(
        id="e_001",
        source_type=EvidenceSource.CROSSREF,
        citation="Crossref query returned no results",
        snippet="",
        retrieved_by_step_id="s1",
    )
    assert e.url is None


def test_finding_with_why_wrong_and_correction():
    """UnifiedVerifier output includes why_wrong and correct_information."""
    from argus.models.domain import CorrectedInfo, VerificationStep
    f = Finding(
        id="f_1",
        job_id="j1",
        claim_id="c1",
        agent="UnifiedVerifier",
        verdict=FindingVerdict.INACCURATE,
        severity=Severity.MAJOR,
        confidence=0.92,
        summary="GDP figure is outdated.",
        why_wrong="The claim cites the advance estimate (2.8%) which was revised to 3.1%.",
        correct_information=CorrectedInfo(
            value="2024 Q3 GDP growth rate: 3.1% (third estimate)",
            source="Bureau of Economic Analysis via FRED",
            url="https://fred.stlouisfed.org/series/GDP",
            retrieved_date="2026-05-26",
        ),
        reasoning_chain=[
            VerificationStep(
                action="Searched 'US 2024 Q3 GDP growth rate official'",
                observation="BEA released three estimates: advance 2.8%, second 2.8%, third 3.1%",
                reasoning="The claim uses the advance estimate which has been superseded",
            ),
        ],
        evidence_ids=[],
        reasoning_trace_id="t1",
    )
    assert f.verdict == FindingVerdict.INACCURATE
    assert f.why_wrong is not None
    assert f.correct_information is not None
    assert f.correct_information.value == "2024 Q3 GDP growth rate: 3.1% (third estimate)"
    assert len(f.reasoning_chain) == 1
    assert f.reasoning_chain[0].action is not None


def test_finding_ok_verdict_no_correction():
    """When verdict is ok, why_wrong and correct_information are None."""
    from argus.models.domain import VerificationStep
    f = Finding(
        id="f_2",
        job_id="j1",
        claim_id="c2",
        agent="UnifiedVerifier",
        verdict=FindingVerdict.OK,
        severity=Severity.MINOR,
        confidence=0.95,
        summary="Claim verified against two independent sources.",
        reasoning_chain=[
            VerificationStep(
                action="Searched CrossRef for 'Smith 2021 widget resilience'",
                observation="Found DOI 10.1234/x with matching title and authors",
                reasoning="Primary source confirmed",
            ),
        ],
        evidence_ids=[],
        reasoning_trace_id="t2",
    )
    assert f.why_wrong is None
    assert f.correct_information is None


def test_verification_step_structure():
    """VerificationStep uses action/observation/reasoning triple."""
    from argus.models.domain import VerificationStep
    step = VerificationStep(
        action="Fetched https://api.crossref.org/works?query=Smith",
        observation="No matching results found",
        reasoning="CrossRef has no record of this paper",
    )
    assert step.action == "Fetched https://api.crossref.org/works?query=Smith"
    assert step.observation == "No matching results found"
    assert step.reasoning == "CrossRef has no record of this paper"


def test_outdated_verdict():
    """OUTDATED verdict value works."""
    assert FindingVerdict.OUTDATED == "outdated"
    assert FindingVerdict.INACCURATE == "inaccurate"
