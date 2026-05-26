"""Stable, normalized cache key derivation for verifier findings."""
from __future__ import annotations

import hashlib
import re

_WS = re.compile(r"\s+")


def _normalize(text: str) -> str:
    """Lowercase + collapse whitespace → stable cache key input."""
    return _WS.sub(" ", text.strip().lower())


def claim_cache_key(claim_text: str, *, domain: str, version: str) -> str:
    """sha256(normalized(claim_text) | domain | version) → hex digest.

    Version is bumped when prompt or output schema changes, invalidating
    all prior cache for that verifier generation.
    """
    raw = f"{_normalize(claim_text)}|{domain}|{version}"
    return hashlib.sha256(raw.encode()).hexdigest()
