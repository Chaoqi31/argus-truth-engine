"""Review-gate hard cap on claims sent to Phase B verification.

The atomizer can over-split a long report into 50+ atoms, each costing one
paid MiroMind deep-research call. ``max_claims_to_verify`` is a deterministic
cost guard: review_gate ranks the claims and keeps only the top N, publishing
a ``claims_capped`` event so the truncation is never silent.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from argus.config import Settings
from argus.models.domain import Claim, ClaimType
from argus.orchestrator.context import _Ctx
from argus.orchestrator.nodes.review_gate import _review_gate_node


class _RecordingPublisher:
    """Captures published (kind, payload) tuples for assertions."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, kind: str, payload: dict[str, Any]) -> None:
        self.events.append((kind, payload))


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


def _ctx(publisher: _RecordingPublisher, *, max_claims: int) -> _Ctx:
    return _Ctx(
        client=AsyncMock(),
        settings=Settings(miromind_api_key="x", max_claims_to_verify=max_claims),
        budget=AsyncMock(),
        runners={},
        job_id="job_cap",
        publisher=publisher,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_auto_review_caps_to_top_n_by_importance() -> None:
    pub = _RecordingPublisher()
    ctx = _ctx(pub, max_claims=3)

    # 6 claims of mixed importance/type. Expected top-3 (ascending key:
    # importance high<medium<low, then type citation<numerical<...<qualitative,
    # then original index):
    #   c_hi_cite (high, citation)       rank (0, 0, 0)
    #   c_hi_qual (high, qualitative)    rank (0, 4, 1)
    #   c_med_num (medium, numerical)    rank (1, 1, 3)
    claims = [
        _claim("c_hi_cite", importance="high", ctype=ClaimType.CITATION),
        _claim("c_low_a", importance="low"),
        _claim("c_med_qual", importance="medium"),
        _claim("c_hi_qual", importance="high"),
        _claim("c_med_num", importance="medium", ctype=ClaimType.NUMERICAL_DATA),
        _claim("c_low_b", importance="low"),
    ]

    node = _review_gate_node(ctx, auto_review=True)
    result = await node({"claims": claims})

    kept = result["claims"]
    assert len(kept) == 3
    kept_ids = [c.id for c in kept]
    assert set(kept_ids) == {"c_hi_cite", "c_hi_qual", "c_med_num"}

    # Highest-importance kept; lowest dropped.
    assert "c_low_a" not in kept_ids
    assert "c_low_b" not in kept_ids
    assert "c_med_qual" not in kept_ids

    # High before medium; within high, citation before qualitative.
    assert kept_ids.index("c_hi_cite") < kept_ids.index("c_hi_qual")
    assert kept_ids.index("c_hi_qual") < kept_ids.index("c_med_num")

    capped = [p for k, p in pub.events if k == "claims_capped"]
    assert len(capped) == 1
    assert capped[0] == {"n_extracted": 6, "n_verifying": 3}


@pytest.mark.asyncio
async def test_under_cap_unchanged_no_event() -> None:
    pub = _RecordingPublisher()
    ctx = _ctx(pub, max_claims=25)

    claims = [
        _claim("c1", importance="high"),
        _claim("c2", importance="low"),
    ]

    node = _review_gate_node(ctx, auto_review=True)
    result = await node({"claims": claims})

    # No cap applied → auto_review pass-through returns {} (full list kept).
    assert result == {}
    assert not [p for k, p in pub.events if k == "claims_capped"]
