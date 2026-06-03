"""HITL resume round-trip, fully offline.

Stage 1: audit_text(auto_review=False) with a checkpointer → review_gate calls
interrupt() → graph pauses → job persisted as "interrupted" with NO Phase B.
Stage 2: audit_resume(selected=["c1"]) → only c1 is verified, status "done".

Proves the review gate gates (Fix A): a single shared MemorySaver + the SAME
mock client across both calls (so the router's deques carry over).
"""
from __future__ import annotations

import json
from pathlib import Path

from langgraph.checkpoint.memory import MemorySaver
from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.config import Settings
from argus.db.repository import JobRepository
from argus.orchestrator.entry import audit_resume, audit_text
from tests._helpers.mock_miromind import StreamRouter, completed, msg, tool


def _planner_two() -> str:
    return json.dumps(
        {
            "claims": [
                {"id": "c1", "text": "France GDP grew 12% in 2099.", "page": 1,
                 "span": [0, 28], "type": "numerical_data", "importance": "high",
                 "extracted_metadata": {}},
                {"id": "c2", "text": "Paris is the capital of France.", "page": 1,
                 "span": [29, 60], "type": "qualitative", "importance": "low",
                 "extracted_metadata": {}},
            ]
        }
    )


def _verifier() -> str:
    return json.dumps({
        "verdict": "fabricated", "confidence": 0.9, "summary": "No source.",
        "why_wrong": "No record.", "correct_information": None,
        "evidence": [
            {"source_type": "web", "url": "http://a", "snippet": "x"},
            {"source_type": "web", "url": "http://b", "snippet": "y"},
        ],
        "reasoning_chain": [
            {"action": "search", "observation": "0", "reasoning": "none"},
            {"action": "search2", "observation": "0", "reasoning": "none"},
        ],
    })


def _consistency() -> str:
    return json.dumps({"contradictions": [], "logical_flaws": []})


def _reporter() -> str:
    return json.dumps({"executive_summary_md": "done", "ranked_finding_ids": []})


async def test_phase_a_pauses_at_review_then_resumes(
    tmp_path: Path, sqlite_engine: object
) -> None:
    repo = JobRepository(async_sessionmaker(sqlite_engine, expire_on_commit=False))

    router = StreamRouter()
    router.add("planner", [msg(_planner_two()), completed(tokens=80)])
    # Only c1 is selected on resume, so exactly one verifier stream is consumed.
    router.add("unified_verifier",
               [tool("web_search", {"q": "x"}, 2), msg(_verifier()), completed(tokens=60)])
    router.add("consistency", [msg(_consistency()), completed(tokens=20)])  # defensive
    router.add("reporter", [msg(_reporter()), completed(tokens=20)])

    cp = MemorySaver()
    # Same client instance across both stages: the router's deques carry over.
    client = router.make_client()
    settings = Settings(
        miromind_api_key="x",
        cheap_llm_api_key="",
        cache_enabled=False,
        miromind_retry_base_delay_s=0.001,
    )
    out = tmp_path / "f.json"

    # ── Stage 1: pause at the review gate ──────────────────────────────────
    job1 = await audit_text(
        text="France GDP grew twelve percent in 2099 per the ministry report.",
        output_path=out,
        settings=settings,
        client=client,
        budget_usd=10.0,
        repo=repo,
        trace_bus=None,
        job_id="job_t",
        auto_review=False,
        content_domain="general",
        checkpointer=cp,
    )
    assert job1.status == "interrupted"
    assert len(job1.claims) == 2
    assert [f for f in job1.findings if f.agent == "UnifiedVerifier"] == []

    # ── Stage 2: resume with only c1 selected ──────────────────────────────
    job2 = await audit_resume(
        job_id="job_t",
        selected_claim_ids=["c1"],
        settings=settings,
        client=client,
        budget_usd=10.0,
        repo=repo,
        trace_bus=None,
        output_path=out,
        checkpointer=cp,
    )
    assert job2.status == "done"
    verifier_findings = [f for f in job2.findings if f.agent == "UnifiedVerifier"]
    assert len(verifier_findings) == 1
    assert verifier_findings[0].claim_id == "c1"
