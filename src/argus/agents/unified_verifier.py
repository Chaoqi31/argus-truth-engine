"""Unified Verifier agent: autonomously verifies any factual claim."""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner, StepCallback
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
    "evidence_quality": [
      {
        "evidence_index": 0-based index into evidence[],
        "authority": float in [0.0, 1.0],
        "independence": float in [0.0, 1.0],
        "freshness": float in [0.0, 1.0],
        "directness": float in [0.0, 1.0],
        "role": "primary_source"|"secondary_source"|"search_absence"|"computed_value"|"other",
        "rationale": "why this evidence is or is not strong"
      }
    ],
    "coverage": [
      {
        "claim_fragment": "one atomic fragment of the claim",
        "relation": "supports"|"refutes"|"unsupported"|"outdated"|"misrepresented"|"uncertain",
        "evidence_indices": [0-based indices into evidence[]],
        "reason": "how the cited evidence affects this fragment"
      }
    ],
    "computation_check": {
      "kind": "numeric"|"date",
      "claimed_value": "value/date/status stated by the claim",
      "extracted_values": [
        {
          "label": "what this value is",
          "value": "extracted value as text",
          "unit": "unit or empty string",
          "source_evidence_index": 0-based index into evidence[] or null
        }
      ],
      "formula": "calculation or comparison performed, empty if none",
      "computed_value": "computed result",
      "tolerance": "rounding/date validity threshold",
      "judgment": "matches"|"refutes"|"uncertain",
      "rationale": "why the calculation/date check matters"
    } | null,
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
  - coverage MUST decompose the claim into the smallest useful factual fragments.
  - evidence_quality MUST explain source authority, independence, freshness, and directness.
  - If the claim involves numbers, percentages, growth rates, dates, or "as of" validity,
    use execute_python when useful and populate computation_check. Otherwise set it to null.
  - correct_information MUST be non-null whenever verdict is inaccurate or outdated.
  - why_wrong MUST be non-null for any verdict other than ok or uncertain.
OUTPUT ONLY THE JSON OBJECT.
"""


# NOTE: the nested fields below are intentionally lenient (optional with
# defaults). MiroThinker's real deep-research output is high-quality but does
# not always populate every sub-field (e.g. it omits a step's `observation`,
# labels evidence with `source` instead of `source_type`, etc.). A strict
# schema would reject those whole responses and lose the (paid) verdict. We
# accept partial structures and let the verdict/summary/evidence carry through.
class EvidenceOut(BaseModel):
    source_type: str = "web_page"  # free-form; MiroMind picks the best label
    url: str | None = None
    snippet: str = ""


class CorrectedInfoOut(BaseModel):
    value: str = ""
    source: str = ""
    url: str | None = None
    retrieved_date: str | None = None


class VerificationStepOut(BaseModel):
    action: str = ""
    observation: str = ""
    reasoning: str = ""


class EvidenceQualityOut(BaseModel):
    evidence_index: int = Field(default=0, ge=0)
    authority: float = Field(default=0.0, ge=0.0, le=1.0)
    independence: float = Field(default=0.0, ge=0.0, le=1.0)
    freshness: float = Field(default=0.0, ge=0.0, le=1.0)
    directness: float = Field(default=0.0, ge=0.0, le=1.0)
    role: str = ""
    rationale: str = ""


class CoverageOut(BaseModel):
    claim_fragment: str = ""
    relation: str = "uncertain"
    evidence_indices: list[int] = Field(default_factory=list)
    reason: str = ""


class ComputationValueOut(BaseModel):
    label: str = ""
    value: str = ""
    unit: str = ""
    source_evidence_index: int | None = None


class ComputationCheckOut(BaseModel):
    kind: str = "numeric"
    claimed_value: str = ""
    extracted_values: list[ComputationValueOut] = Field(default_factory=list)
    formula: str = ""
    computed_value: str = ""
    tolerance: str = ""
    judgment: str = "uncertain"
    rationale: str = ""


class UnifiedVerifierOutput(BaseModel):
    verdict: FindingVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    why_wrong: str | None = None
    correct_information: CorrectedInfoOut | None = None
    evidence: list[EvidenceOut] = Field(default_factory=list)
    evidence_quality: list[EvidenceQualityOut] = Field(default_factory=list)
    coverage: list[CoverageOut] = Field(default_factory=list)
    computation_check: ComputationCheckOut | None = None
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
    idempotency_key: str | None = None,
    on_step: StepCallback | None = None,
) -> AgentResult[UnifiedVerifierOutput]:
    runner = AgentRunner(
        client=client,
        model_cls=UnifiedVerifierOutput,
        agent_name="unified_verifier",
        max_output_tokens=6000,
        on_step=on_step,
    )
    return await runner.run(
        instructions=SYSTEM_PROMPT,
        input_text=build_verifier_input(claim, surrounding, domain_hint),
        idempotency_key=idempotency_key,
    )
