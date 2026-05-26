"""Domain hint builder for UnifiedVerifier.

Combines claim-type hints and content-domain hints into a single
suggestion string that can be injected into verifier prompts.
"""
from __future__ import annotations

from argus.models.domain import ClaimType

_CLAIM_TYPE_HINTS: dict[str, str] = {
    ClaimType.CITATION: (
        "Consider checking citation databases such as Google Scholar, CrossRef,"
        " arXiv, or Semantic Scholar to locate the original source."
    ),
    ClaimType.NUMERICAL_DATA: (
        "Consider verifying against primary data sources such as government"
        " statistical agencies, central bank databases (e.g. FRED, IMF, World Bank),"
        " or official company filings."
    ),
    ClaimType.TIME_SENSITIVE: (
        "Consider checking the most recent publications or official announcements;"
        " this type of claim may have been superseded by newer data."
    ),
    ClaimType.CROSS_REFERENCE: (
        "Consider verifying the claim across multiple independent sources to check"
        " for consistency."
    ),
    ClaimType.QUALITATIVE: (
        "Consider looking for expert commentary, systematic reviews, or authoritative"
        " reference works relevant to this claim."
    ),
}

_DOMAIN_HINTS: dict[str, str] = {
    "academic": (
        "Useful sources include: Google Scholar, Semantic Scholar, PubMed, arXiv,"
        " SSRN, university institutional repositories, and DOI/citation lookups."
    ),
    "medical": (
        "Useful sources include: PubMed, Cochrane Library, NIH (nih.gov),"
        " CDC (cdc.gov), FDA (fda.gov), WHO publications, and peer-reviewed medical"
        " journals such as NEJM, Lancet, BMJ, and JAMA."
    ),
    "legal": (
        "Useful sources include: official court records, case-law databases,"
        " government legislation sites (.gov), legal journals, and bar association"
        " publications."
    ),
    "finance": (
        "Useful sources include: SEC EDGAR, FRED (Federal Reserve), World Bank Open"
        " Data, IMF, company filings (10-K / 10-Q), and Bloomberg or Reuters for"
        " market-data verification."
    ),
    "technology": (
        "Useful sources include: official product documentation and changelogs,"
        " GitHub repositories and release notes, and industry benchmark reports."
    ),
    "news": (
        "Useful sources include: major wire services (AP, Reuters, AFP),"
        " official government or institutional press releases, and fact-checking"
        " organisations such as Snopes, PolitiFact, and FactCheck.org."
    ),
    "science": (
        "Useful sources include: peer-reviewed journals (Nature, Science, PNAS),"
        " preprint servers (arXiv, bioRxiv, medRxiv), and scientific databases"
        " such as NASA, NOAA, and CERN."
    ),
}


def get_domain_hint(*, claim_type: ClaimType, content_domain: str = "general") -> str:
    """Return a hint string combining claim-type and content-domain suggestions.

    Args:
        claim_type: The type of the claim being verified.
        content_domain: The domain of the content (e.g. 'medical', 'finance').

    Returns:
        A newline-joined string of applicable hints, or empty string if none apply.
    """
    parts: list[str] = []

    claim_hint = _CLAIM_TYPE_HINTS.get(claim_type)
    if claim_hint:
        parts.append(claim_hint)

    domain_hint = _DOMAIN_HINTS.get(content_domain)
    if domain_hint:
        parts.append(domain_hint)

    return "\n".join(parts)
