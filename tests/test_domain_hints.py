from argus.agents.domain_hints import get_domain_hint
from argus.models.domain import ClaimType


def test_citation_claim_gets_academic_hint():
    hint = get_domain_hint(claim_type=ClaimType.CITATION, content_domain="general")
    assert "scholar" in hint.lower() or "crossref" in hint.lower() or "arxiv" in hint.lower()


def test_numerical_claim_gets_data_hint():
    hint = get_domain_hint(claim_type=ClaimType.NUMERICAL_DATA, content_domain="finance")
    assert "sec" in hint.lower() or "fred" in hint.lower() or "edgar" in hint.lower()


def test_qualitative_claim_gets_general_hint():
    hint = get_domain_hint(claim_type=ClaimType.QUALITATIVE, content_domain="general")
    assert isinstance(hint, str)


def test_medical_domain_mentions_pubmed():
    hint = get_domain_hint(claim_type=ClaimType.QUALITATIVE, content_domain="medical")
    assert "pubmed" in hint.lower() or "nih" in hint.lower()


def test_unknown_domain_returns_string():
    hint = get_domain_hint(claim_type=ClaimType.QUALITATIVE, content_domain="unknown_domain")
    assert isinstance(hint, str)
