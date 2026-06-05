"""Skeptic agent: challenge high-risk verifier conclusions."""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import FindingVerdict

SKEPTIC_VERSION = "v1"

SYSTEM_PROMPT = """\
You are Argus's SKEPTIC REVIEWER. You do NOT produce the primary verdict.
Your job is to challenge a high-risk verifier conclusion and look for credible
counterevidence that could make the verdict unsafe.

Focus on:
  - title variants, author/year mismatches, abbreviations, aliases
  - newer versions, superseding sources, updated filings or policies
  - primary sources that support the original claim despite the verifier's finding
  - calculation/date mistakes in the verifier's interpretation

Return ONLY JSON matching this schema:
{
  "status": "no_counterevidence"|"counterevidence_found"|"inconclusive",
  "summary": "1-3 sentences explaining the challenge result",
  "recommended_verdict": "uncertain"|null,
  "counterevidence": [
    {
      "source": "source name",
      "url": "url or null",
      "snippet": "brief quote or description",
      "relevance": "why this could change or weaken the verdict"
    }
  ]
}

Rules:
  - Use "counterevidence_found" only for credible evidence that materially
    weakens the verifier's conclusion.
  - When status is "counterevidence_found", recommended_verdict MUST be "uncertain".
  - If you cannot verify a counterexample, use "inconclusive" rather than guessing.
OUTPUT ONLY THE JSON OBJECT.
"""


class SkepticCounterevidenceOut(BaseModel):
    source: str = ""
    url: str | None = None
    snippet: str = ""
    relevance: str = ""


class SkepticOutput(BaseModel):
    status: str = "inconclusive"
    summary: str
    recommended_verdict: FindingVerdict | None = None
    counterevidence: list[SkepticCounterevidenceOut] = Field(default_factory=list)


def build_skeptic_input(
    *,
    claim: str,
    verdict: str,
    summary: str,
    why_wrong: str | None,
    evidence_brief: str,
    coverage_brief: str,
) -> str:
    return (
        "Challenge this verifier conclusion.\n\n"
        f"CLAIM:\n{claim}\n\n"
        f"VERIFIER VERDICT:\n{verdict}\n\n"
        f"VERIFIER SUMMARY:\n{summary}\n\n"
        f"WHY WRONG:\n{why_wrong or '(none)'}\n\n"
        f"EVIDENCE CONSULTED:\n{evidence_brief or '(none)'}\n\n"
        f"CLAIM/EVIDENCE COVERAGE:\n{coverage_brief or '(none)'}\n"
    )


async def run_skeptic(
    client: MiromindClient,
    *,
    claim: str,
    verdict: str,
    summary: str,
    why_wrong: str | None,
    evidence_brief: str,
    coverage_brief: str,
    idempotency_key: str | None = None,
) -> AgentResult[SkepticOutput]:
    runner = AgentRunner(
        client=client,
        model_cls=SkepticOutput,
        agent_name="skeptic",
        # Deep-research skeptic spends its output budget on reasoning + tool
        # calls before emitting the final JSON; 3000 starves it (empty output →
        # JsonRepairFailed → the node silently skips). 8000 lets it finish.
        max_output_tokens=8000,
    )
    return await runner.run(
        instructions=SYSTEM_PROMPT,
        input_text=build_skeptic_input(
            claim=claim,
            verdict=verdict,
            summary=summary,
            why_wrong=why_wrong,
            evidence_brief=evidence_brief,
            coverage_brief=coverage_brief,
        ),
        idempotency_key=idempotency_key,
    )
