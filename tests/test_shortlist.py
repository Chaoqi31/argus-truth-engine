"""The shortlist: duplicates dropped and the verification cap applied before
the reviewer sees the candidates.

Each claim that reaches verification is one paid MiroMind deep-research
call, and the atomizer can split a long report into 50+ atoms or repeat a
claim verbatim. `max_claims_to_verify` is a deterministic cost guard.
"""
from __future__ import annotations

from argus.audit.claims import dedupe_claims, most_important
from argus.models.domain import Claim, ClaimType


def _claim(
    cid: str,
    *,
    importance: str,
    ctype: ClaimType = ClaimType.QUALITATIVE,
) -> Claim:
    return Claim(
        id=cid,
        text=f"claim {cid}",
        page=1,
        span=(0, 10),
        type=ctype,
        importance=importance,
    )


def _text_claim(cid: str, text: str) -> Claim:
    return Claim(
        id=cid, text=text, page=1, span=(0, 10),
        type=ClaimType.NUMERICAL_DATA, importance="high",
    )


def test_the_cap_keeps_the_most_important_claims_in_rank_order() -> None:
    # Ranked by importance (high < medium < low), then type (citation <
    # numerical < ... < qualitative), then original position.
    claims = [
        _claim("c_hi_cite", importance="high", ctype=ClaimType.CITATION),
        _claim("c_low_a", importance="low"),
        _claim("c_med_qual", importance="medium"),
        _claim("c_hi_qual", importance="high"),
        _claim("c_med_num", importance="medium", ctype=ClaimType.NUMERICAL_DATA),
        _claim("c_low_b", importance="low"),
    ]

    kept = most_important(claims, 3)

    assert [c.id for c in kept] == ["c_hi_cite", "c_hi_qual", "c_med_num"]


def test_claims_under_the_cap_stay_as_they_are() -> None:
    claims = [_claim("c1", importance="high"), _claim("c2", importance="low")]

    assert most_important(claims, 25) == claims


def test_duplicates_up_to_case_whitespace_and_punctuation_are_dropped() -> None:
    claims = [
        _text_claim("a1", "Margins reached 32% in the quarter."),
        _text_claim("a2", "The company's data-center revenue was $18.4B in Q3."),
        _text_claim("a3", "margins reached 32% in the quarter"),
        _text_claim("a4", "Margins  reached  32%   in the quarter."),
    ]

    assert [c.id for c in dedupe_claims(claims)] == ["a1", "a2"]


def test_a_citation_and_the_number_it_contains_are_both_kept() -> None:
    claims = [
        _text_claim("a1", "According to Smith et al. (2023), global GDP grew 3.2% in 2024."),
        _text_claim("a2", "Global GDP grew 3.2% in 2024."),
    ]

    assert dedupe_claims(claims) == claims
