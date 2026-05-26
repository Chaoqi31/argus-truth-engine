"""Cache key derivation: stable, domain-scoped, version-gated."""
from argus.cache.key import claim_cache_key


def test_key_is_stable_for_identical_input():
    k1 = claim_cache_key("Acme Q3 revenue grew 42%.", domain="finance", version="v1")
    k2 = claim_cache_key("Acme Q3 revenue grew 42%.", domain="finance", version="v1")
    assert k1 == k2


def test_key_normalizes_whitespace_and_case():
    k1 = claim_cache_key("Acme Q3 revenue grew 42%.", domain="finance", version="v1")
    k2 = claim_cache_key("  acme  Q3   revenue grew 42%.  ", domain="finance", version="v1")
    assert k1 == k2


def test_key_differs_by_domain():
    k1 = claim_cache_key("X is true.", domain="finance", version="v1")
    k2 = claim_cache_key("X is true.", domain="legal", version="v1")
    assert k1 != k2


def test_key_differs_by_version():
    k1 = claim_cache_key("X is true.", domain="finance", version="v1")
    k2 = claim_cache_key("X is true.", domain="finance", version="v2")
    assert k1 != k2


def test_key_is_64_hex_chars():
    k = claim_cache_key("test", domain="general", version="v1")
    assert len(k) == 64
    assert all(c in "0123456789abcdef" for c in k)
