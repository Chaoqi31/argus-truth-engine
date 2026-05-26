"""Minimal smoke test — 1 claim through the real MiroMind API.

Usage:
    cd /Users/luochaoqi/dev/MiroMind-Deep-Research
    python scripts/smoke_test.py

Budget capped at $5. Prints the full finding with reasoning chain.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

# Ensure the project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from argus.config import settings as load_settings
from argus.orchestrator import audit_text


# --- Test text: ONE deliberately wrong claim ---
# The real figure is ~3.1% (third estimate). We say 1.6% — clearly wrong.
TEST_TEXT = (
    "According to the Bureau of Economic Analysis, "
    "U.S. real GDP grew at an annual rate of 1.6% in the third quarter of 2024."
)


async def main() -> None:
    s = load_settings()
    if not s.miromind_api_key:
        print("ERROR: ARGUS_MIROMIND_API_KEY not set in .env")
        sys.exit(1)

    out_path = Path("tmp/smoke_test_output.json")
    out_path.parent.mkdir(exist_ok=True)

    print(f"Input text:\n  {TEST_TEXT}\n")
    print("Running pipeline (planner → atomizer → checkworthiness → unified_verifier → reporter)...")
    print(f"Budget cap: $5\n")

    job = await audit_text(
        text=TEST_TEXT,
        output_path=out_path,
        settings=s,
        budget_usd=5.0,
        content_domain="finance",
    )

    print(f"Status: {job.status}")
    print(f"Cost: ${job.cost_usd:.4f}")
    print(f"Total tokens: {job.total_tokens}")
    print(f"Claims extracted: {len(job.claims)}")
    print(f"Findings: {len(job.findings)}")
    print()

    for i, f in enumerate(job.findings, 1):
        print(f"═══ Finding {i} ═══")
        print(f"  Claim:    {f.claim_id}")
        print(f"  Verdict:  {f.verdict.value}")
        print(f"  Severity: {f.severity.value}")
        print(f"  Confidence: {f.confidence}")
        print(f"  Summary:  {f.summary}")
        if f.why_wrong:
            print(f"  Why wrong: {f.why_wrong}")
        if f.correct_information:
            ci = f.correct_information
            print(f"  Correct:  {ci.value}")
            print(f"  Source:   {ci.source}")
            if ci.url:
                print(f"  URL:      {ci.url}")
        if f.reasoning_chain:
            print(f"  Reasoning chain ({len(f.reasoning_chain)} steps):")
            for j, step in enumerate(f.reasoning_chain, 1):
                if hasattr(step, "action"):
                    print(f"    [{j}] Action:      {step.action}")
                    print(f"        Observation: {step.observation}")
                    print(f"        Reasoning:   {step.reasoning}")
                else:
                    print(f"    [{j}] {step.step}: {step.content}")
        print()

    if job.audit_report_md:
        print("═══ Executive Summary ═══")
        print(job.audit_report_md)
        print()

    print(f"Full output saved to: {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
