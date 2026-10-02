"""Soft ≥2-source enforcement: count distinct sources from evidence AND the
reasoning chain, then cap confidence + flag under-sourced web verdicts without
discarding them (MiroThinker under-logs sources, so hard rejection would throw
away sound, paid verdicts)."""
from __future__ import annotations

from pathlib import Path

import pytest
import requests
from tldextract import TLDExtract

from argus.audit import confidence
from argus.audit.confidence import (
    count_distinct_sources,
    evaluate_sourcing,
    rescored,
)
from argus.models.domain import (
    Evidence,
    EvidenceSource,
    Finding,
    FindingFlag,
    FindingVerdict,
    VerificationStep,
)


def _ev(eid: str, url: str | None = None) -> Evidence:
    return Evidence(
        id=eid, source_type=EvidenceSource.WEB_PAGE, url=url,
        citation="c", snippet="s", retrieved_by_step_id="st",
    )


def _finding(
    *,
    verdict: FindingVerdict = FindingVerdict.FABRICATED,
    agent: str = "verifier",
    confidence: float = 0.9,
    chain: list[VerificationStep] | None = None,
    evidence_ids: list[str] | None = None,
) -> Finding:
    return Finding(
        id="f", claim_id="c", agent=agent, verdict=verdict,
        confidence=confidence, summary="s", reasoning_trace_id="t",
        reasoning_chain=chain or [], evidence_ids=evidence_ids or [],
    )


# --- count_distinct_sources -------------------------------------------------

def test_count_dedupes_domains_and_strips_www() -> None:
    evs = [_ev("e1", "https://www.reuters.com/a"),
           _ev("e2", "https://reuters.com/b"),
           _ev("e3", "https://sec.gov/x")]
    assert count_distinct_sources(_finding(), evs) == 2  # reuters + sec.gov


@pytest.mark.parametrize(
    "urls",
    [
        ("https://reuters.com/a", "https://graphics.reuters.com/b", "https://jp.reuters.com/c"),
        ("https://bbc.co.uk/a", "https://news.bbc.co.uk/b", "https://sport.bbc.co.uk/c"),
        ("https://REUTERS.COM/a", "https://graphics.reuters.com./b", "https://www.reuters.com/c"),
        ("https://b\u00fccher.de/a", "https://xn--bcher-kva.de/b", "https://news.b\u00fccher.de/c"),
    ],
)
def test_subdomains_of_one_publisher_count_once(urls: tuple[str, ...]) -> None:
    evs = [_ev(f"e{i}", url) for i, url in enumerate(urls)]

    assert count_distinct_sources(_finding(), evs) == 1
    updated = rescored(_finding(confidence=0.95), evs)
    assert updated.confidence == 0.6
    assert FindingFlag.SINGLE_SOURCE in updated.flags


@pytest.mark.parametrize("suffix", ["co.uk", "github.io", "blogspot.com"])
def test_distinct_registrants_and_hosted_tenants_remain_independent(suffix: str) -> None:
    evs = [
        _ev("e1", f"https://alice.{suffix}/a"),
        _ev("e2", f"https://bob.{suffix}/b"),
        _ev("e3", f"https://news.alice.{suffix}/c"),
    ]

    assert count_distinct_sources(_finding(), evs) == 2


def test_reasoning_chain_and_evidence_share_the_same_publisher_key() -> None:
    chain = [VerificationStep(
        action="Read https://graphics.reuters.com/b and https://news.bbc.co.uk/c",
        observation="", reasoning="",
    )]
    evs = [_ev("e1", "https://reuters.com/a"), _ev("e2", "https://bbc.co.uk/d")]

    assert count_distinct_sources(_finding(chain=chain), evs) == 2


def test_unlisted_hosts_and_ip_addresses_do_not_collapse_together() -> None:
    evs = [
        _ev("e1", "http://localhost/a"),
        _ev("e2", "http://127.0.0.1/b"),
        _ev("e3", "http://127.0.0.2/c"),
        _ev("e4", "http://[::1]/d"),
        _ev("e5", "http://research.internal/e"),
        _ev("e6", "http://other.internal/f"),
    ]

    assert count_distinct_sources(_finding(), evs) == 6


def test_publisher_extraction_uses_the_bundled_list_without_network_or_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def no_network(*args: object, **kwargs: object) -> None:
        pytest.fail("source counting must not fetch the suffix list")

    monkeypatch.setattr(requests.Session, "get", no_network)
    monkeypatch.setenv("TLDEXTRACT_PUBLIC_SUFFIX_LIST_URLS", "https://must-not-fetch.invalid/list")
    monkeypatch.setenv("TLDEXTRACT_CACHE", str(tmp_path))
    monkeypatch.setattr(confidence, "_SOURCE_DOMAINS", TLDExtract(
        suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True
    ))

    evs = [_ev("e1", "https://reuters.com/a"), _ev("e2", "https://graphics.reuters.com/b")]
    assert count_distinct_sources(_finding(), evs) == 1
    assert not tuple(tmp_path.iterdir())


def test_count_includes_reasoning_chain_urls() -> None:
    chain = [VerificationStep(
        action="searched https://arxiv.org/abs/1 then https://crossref.org/y",
        observation="", reasoning="")]
    evs = [_ev("e1", "https://reuters.com/a")]
    assert count_distinct_sources(_finding(chain=chain), evs) == 3


def test_count_urlless_evidence_each_counts() -> None:
    assert count_distinct_sources(_finding(), [_ev("e1"), _ev("e2")]) == 2


# --- evaluate_sourcing ------------------------------------------------------

def test_single_source_caps_and_flags() -> None:
    cap, flag = evaluate_sourcing(_finding(verdict=FindingVerdict.FABRICATED), 1)
    assert cap == 0.6 and flag is not None and "single source" in flag


def test_negative_two_sources_undersourced() -> None:
    cap, flag = evaluate_sourcing(_finding(verdict=FindingVerdict.FABRICATED), 2)
    assert cap == 0.75 and flag is not None and "under-sourced" in flag


def test_positive_two_sources_ok() -> None:
    assert evaluate_sourcing(_finding(verdict=FindingVerdict.OK), 2) == (None, None)


def test_negative_three_sources_ok() -> None:
    assert evaluate_sourcing(_finding(verdict=FindingVerdict.FABRICATED), 3) == (None, None)


def test_uncertain_never_flagged() -> None:
    assert evaluate_sourcing(_finding(verdict=FindingVerdict.UNCERTAIN), 0) == (None, None)


def test_consistency_finding_not_flagged() -> None:
    f = _finding(verdict=FindingVerdict.CONTRADICTION, agent="consistency")
    assert evaluate_sourcing(f, 0) == (None, None)


# --- rescoring --------------------------------------------------------------


def test_a_single_source_verdict_is_capped_and_flagged() -> None:
    f = _finding(verdict=FindingVerdict.FABRICATED, confidence=0.95, evidence_ids=["e1"])
    evs = [_ev("e1", "https://reuters.com/a")]  # 1 distinct source

    updated = rescored(f, evs)

    assert updated.confidence == 0.6  # capped from 0.95
    assert updated.flags == (FindingFlag.SINGLE_SOURCE,)
    assert updated.confidence_breakdown is not None


def test_a_well_sourced_verdict_keeps_its_confidence() -> None:
    f = _finding(verdict=FindingVerdict.FABRICATED, confidence=0.9,
                 evidence_ids=["e1", "e2", "e3"])
    evs = [_ev("e1", "https://reuters.com/a"),
           _ev("e2", "https://sec.gov/x"),
           _ev("e3", "https://arxiv.org/y")]  # 3 distinct sources

    updated = rescored(f, evs)

    assert updated.confidence == 0.9
    assert updated.flags == ()
