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
    assert f.confidence == 0.92  # noqa: PLR2004
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
