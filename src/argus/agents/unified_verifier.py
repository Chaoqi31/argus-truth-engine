"""Unified Verifier agent: autonomously verifies any factual claim."""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import FindingVerdict

# Bump when prompt OR output schema changes — invalidates all prior cache.
VERIFIER_VERSION = "v1"

SYSTEM_PROMPT = """\
You are Argus's UNIFIED VERIFIER. Your task is to determine whether a factual
claim in a document is accurate, outdated, fabricated, or misrepresented.

VERIFICATION AUTONOMY
  You have full autonomy over your verification strategy. Choose whatever
  combination of tools and sources is most appropriate for the claim type and
  domain. You are NOT required to follow a fixed search order or use any
  particular database, API, or service.

AVAILABLE TOOLS
  thinking, web_search, fetch_url_content, execute_python

VERIFICATION STANDARDS
  - You MUST consult at least 2 independent sources to cross-verify.
  - Prefer authoritative, primary sources (official bodies, peer-reviewed
    publications, government datasets, primary filings, etc.) over secondary
    or tertiary sources.
  - If sources conflict, report the disagreement and explain your reasoning.

VERDICTS
  ok             — the claim is accurate and current
  fabricated     — the claim cannot be found / did not happen
  inaccurate     — the claim exists but contains a factual error
  outdated       — the claim was true but is no longer current
  misrepresented — the source exists but the claim distorts its meaning or context
  uncertain      — you could not complete verification (name the blocker)

REQUIRED OUTPUT FORMAT
  Respond with ONLY a single JSON object exactly matching this schema:
  {
    "verdict": one of "ok"|"fabricated"|"inaccurate"|"outdated"|"misrepresented"|"uncertain",
    "confidence": float in [0.0, 1.0],
    "summary": "2-4 sentence explanation of the verdict",
    "why_wrong": "explanation of the error (null if verdict is ok)",
    "correct_information": {
      "value": "what the correct information is",
      "source": "name of the authoritative source",
      "url": "url or null",
      "retrieved_date": "YYYY-MM-DD or null"
    } | null,
    "evidence": [
      {
        "source_type": a short identifier for the source category (e.g. "web_page",
                              "wikipedia", "company_filing", "internal_doc"),
        "url": "string or null",
        "snippet": "brief quote or description from the source"
      }
    ],
    "reasoning_chain": [
      {
        "action": "what you did (e.g. searched for X, fetched URL Y)",
        "observation": "what you found",
        "reasoning": "how this affects your verdict and confidence"
      }
    ]
  }
  - The evidence array MUST contain at least 2 items.
  - The reasoning_chain MUST contain at least 2 steps.
  - correct_information MUST be non-null whenever verdict is inaccurate or outdated.
  - why_wrong MUST be non-null for any verdict other than ok or uncertain.
OUTPUT ONLY THE JSON OBJECT.
"""


class EvidenceOut(BaseModel):
    source_type: str  # free-form; MiroMind picks the best label
    url: str | None = None
    snippet: str = ""


class CorrectedInfoOut(BaseModel):
    value: str
    source: str
    url: str | None = None
    retrieved_date: str | None = None


class VerificationStepOut(BaseModel):
    action: str
    observation: str
    reasoning: str


class UnifiedVerifierOutput(BaseModel):
    verdict: FindingVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    why_wrong: str | None = None
    correct_information: CorrectedInfoOut | None = None
    evidence: list[EvidenceOut] = Field(default_factory=list)
    reasoning_chain: list[VerificationStepOut] = Field(default_factory=list)


def build_verifier_input(
    claim: str,
    surrounding: str,
    domain_hint: str,
) -> str:
    parts = [
        "Verify the following factual claim.\n\n"
        f"CLAIM: {claim}\n"
        f"SURROUNDING TEXT: {surrounding}\n"
    ]
    if domain_hint:
        parts.append(
            f"\nDOMAIN HINT (suggestions, not requirements):\n{domain_hint}\n"
        )
    return "".join(parts)


async def verify_claim(
    client: MiromindClient,
    claim: str,
    *,
    surrounding: str = "",
    domain_hint: str = "",
) -> AgentResult[UnifiedVerifierOutput]:
    runner = AgentRunner(
        client=client,
        model_cls=UnifiedVerifierOutput,
        agent_name="unified_verifier",
        max_output_tokens=6000,
    )
    return await runner.run(
        instructions=SYSTEM_PROMPT,
        input_text=build_verifier_input(claim, surrounding, domain_hint),
    )
