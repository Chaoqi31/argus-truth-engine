"""Algorithmic confidence decomposition.

Computes 3 of 4 confidence factors from DATA, not LLM estimation:
  - source_authority: domain reputation scoring (rule-based)
  - evidence_freshness: temporal decay from claim date to now
  - source_agreement: ratio of corroborating vs contradicting sources

Only `evidence_specificity` requires LLM understanding (how precisely does
the evidence address the claim?) — this remains LLM-estimated.

This is a key technical differentiator: most systems use a single LLM-estimated
confidence number. We decompose it into measurable, auditable factors.
"""
from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urlparse

from argus.models.domain import ConfidenceBreakdown, Evidence, Finding, FindingVerdict

# --- Domain authority scoring -----------------------------------------------

_AUTHORITY_SCORES: dict[str, float] = {
    # Government & international organizations
    ".gov": 0.95,
    "worldbank.org": 0.95,
    "imf.org": 0.95,
    "un.org": 0.93,
    "who.int": 0.93,
    "europa.eu": 0.93,
    "fred.stlouisfed.org": 0.95,
    "data.sec.gov": 0.95,
    "sec.gov": 0.93,
    "census.gov": 0.95,
    "bls.gov": 0.95,
    "bea.gov": 0.95,
    # Academic & research
    ".edu": 0.90,
    "arxiv.org": 0.90,
    "doi.org": 0.90,
    "crossref.org": 0.90,
    "ssrn.com": 0.85,
    "scholar.google.com": 0.85,
    "pubmed.ncbi.nlm.nih.gov": 0.92,
    "nature.com": 0.92,
    "science.org": 0.92,
    "ieee.org": 0.88,
    # News & reputable media
    "reuters.com": 0.85,
    "apnews.com": 0.85,
    "bbc.com": 0.82,
    "nytimes.com": 0.80,
    "ft.com": 0.82,
    "economist.com": 0.82,
    "bloomberg.com": 0.83,
    # Reference
    "wikipedia.org": 0.70,
    "statista.com": 0.75,
    # Generic web
    "medium.com": 0.40,
    "reddit.com": 0.30,
    "quora.com": 0.30,
}

# Default for unknown domains
_DEFAULT_AUTHORITY = 0.50


def _score_domain(url: str | None) -> float:
    """Score a URL's domain authority. Higher = more trustworthy."""
    if not url:
        return _DEFAULT_AUTHORITY
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
    except Exception:
        return _DEFAULT_AUTHORITY

    # Check exact domain matches first
    for domain, score in _AUTHORITY_SCORES.items():
        if domain.startswith("."):
            # TLD match (e.g. ".gov", ".edu")
            if host.endswith(domain):
                return score
        # Full domain match
        elif host == domain or host.endswith("." + domain):
            return score

    # Heuristic: longer established domains slightly higher
    if host.endswith(".org"):
        return 0.65
    if host.endswith(".com"):
        return 0.55

    return _DEFAULT_AUTHORITY


# --- Temporal freshness scoring -------------------------------------------

_YEAR_PATTERN = re.compile(r"20[12]\d")


def _compute_freshness(evidences: list[Evidence], finding_summary: str) -> float:
    """Compute evidence freshness based on retrieval recency.

    Fresher evidence = higher score. Evidence from today = 1.0,
    evidence from >2 years ago = 0.3.
    """
    if not evidences:
        return 0.5  # No evidence → neutral

    now = datetime.utcnow()
    freshness_scores: list[float] = []

    for ev in evidences:
        # Use retrieved_at timestamp
        age_days = (now - ev.retrieved_at).days
        if age_days <= 1:
            freshness_scores.append(1.0)
        elif age_days <= 30:
            freshness_scores.append(0.95)
        elif age_days <= 90:
            freshness_scores.append(0.85)
        elif age_days <= 365:
            freshness_scores.append(0.70)
        elif age_days <= 730:
            freshness_scores.append(0.50)
        else:
            freshness_scores.append(0.30)

    return sum(freshness_scores) / len(freshness_scores) if freshness_scores else 0.5


# --- Source agreement scoring -------------------------------------------

_NEGATIVE_VERDICTS = {
    FindingVerdict.FABRICATED,
    FindingVerdict.INACCURATE,
    FindingVerdict.OUTDATED,
    FindingVerdict.MISMATCH,
    FindingVerdict.MISREPRESENTED,
    FindingVerdict.STALE,
    FindingVerdict.SUPERSEDED,
    FindingVerdict.CONTRADICTION,
}


def _compute_agreement(finding: Finding, source_count: int) -> float:
    """Compute source agreement: how many independent sources point the same way.

    For negative verdicts (fabricated, mismatch, etc.): want ≥3 sources →
    agreement = n / 3. For positive verdicts (ok): ≥2 sources → agreement = n / 2.
    ``source_count`` is the number of distinct sources (see
    :func:`count_distinct_sources`), not just ``len(evidences)``.
    """
    n = source_count
    if n == 0:
        return 0.3  # No sources = low agreement
    if finding.verdict in _NEGATIVE_VERDICTS:
        return min(1.0, n / 3.0)
    return min(1.0, n / 2.0)


# --- Independent-source counting + soft ≥2-source enforcement ----------------

_URL_RE = re.compile(r"https?://[^\s)\]\"'>]+")


def _domain(url: str | None) -> str:
    if not url:
        return ""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return ""
    return host[4:] if host.startswith("www.") else host


def count_distinct_sources(finding: Finding, evidences: list[Evidence]) -> int:
    """Count distinct independent sources backing a finding.

    Counts distinct domains across the evidence URLs AND any URLs the model
    mentioned in its reasoning_chain (MiroThinker often consults more sources
    than it logs in ``evidence[]``), plus each evidence item that has no URL.
    Counting only ``len(evidence)`` undercounts and would unfairly penalise or
    (with hard enforcement) discard sound verdicts.
    """
    domains: set[str] = set()
    urlless = 0
    for ev in evidences:
        d = _domain(ev.url)
        if d:
            domains.add(d)
        else:
            urlless += 1
    for step in finding.reasoning_chain:
        text = " ".join(
            str(getattr(step, attr, "") or "")
            for attr in ("action", "observation", "reasoning", "content", "evidence_ref")
        )
        for url in _URL_RE.findall(text):
            d = _domain(url)
            if d:
                domains.add(d)
    return len(domains) + urlless


def evaluate_sourcing(finding: Finding, source_count: int) -> tuple[float | None, str | None]:
    """Soft ≥2-source enforcement → (confidence_cap, flag).

    We do NOT discard or downgrade the verdict (MiroThinker under-logs sources,
    so hard rejection would throw away sound, paid verdicts). Instead we cap the
    headline confidence and attach a user-facing caveat. Only applies to
    web-verification findings; UNCERTAIN findings are already non-committal.
    """
    if finding.agent != "UnifiedVerifier" or finding.verdict == FindingVerdict.UNCERTAIN:
        return None, None
    if source_count < 2:
        return 0.6, "single source — verify manually"
    if finding.verdict in _NEGATIVE_VERDICTS and source_count < 3:
        return 0.75, "under-sourced — verify manually"
    return None, None


# --- Main computation ---------------------------------------------------


def compute_confidence_breakdown(
    finding: Finding,
    evidences: list[Evidence],
    *,
    llm_specificity: float | None = None,
    source_count: int | None = None,
) -> ConfidenceBreakdown:
    """Compute confidence breakdown from data + optional LLM specificity.

    Three factors are computed algorithmically:
      - source_authority: from URL domain reputation
      - evidence_freshness: from temporal recency
      - source_agreement: from evidence count and consistency

    One factor is LLM-estimated (passed in):
      - evidence_specificity: how precisely evidence addresses the claim

    The composite confidence is a weighted average:
      authority(25%) + freshness(20%) + agreement(30%) + specificity(25%)
    """
    # Algorithmic factors
    authority_scores = [_score_domain(ev.url) for ev in evidences]
    source_authority = (
        max(authority_scores) if authority_scores else _DEFAULT_AUTHORITY
    )

    if source_count is None:
        source_count = count_distinct_sources(finding, evidences)
    evidence_freshness = _compute_freshness(evidences, finding.summary)
    source_agreement = _compute_agreement(finding, source_count)

    # LLM-estimated factor (default to 0.5 if not provided)
    evidence_specificity = llm_specificity if llm_specificity is not None else 0.5

    # Weighted composite
    composite = (
        source_authority * 0.25
        + evidence_freshness * 0.20
        + source_agreement * 0.30
        + evidence_specificity * 0.25
    )

    # Generate human-readable reasoning
    parts: list[str] = []
    if source_authority >= 0.9:
        parts.append("high-authority sources")
    elif source_authority < 0.6:
        parts.append("low-authority sources")

    if evidence_freshness >= 0.9:
        parts.append("very recent evidence")
    elif evidence_freshness < 0.5:
        parts.append("dated evidence")

    if source_agreement >= 0.9:
        parts.append(f"{source_count} sources agree")
    elif source_agreement < 0.5:
        parts.append("limited corroboration")

    reasoning = (
        f"Confidence {composite:.0%}: "
        + (", ".join(parts) if parts else "moderate evidence quality")
        + "."
    )

    return ConfidenceBreakdown(
        source_agreement=round(source_agreement, 3),
        source_authority=round(source_authority, 3),
        evidence_freshness=round(evidence_freshness, 3),
        evidence_specificity=round(evidence_specificity, 3),
        reasoning=reasoning,
    )
