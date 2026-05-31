"""Consistency Checker agent: find self-contradicting claim pairs in one document."""
from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, complete_routed
from argus.llm.cheap_client import CheapLLMClient
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, Severity

SYSTEM_PROMPT = """\
You are Argus's CONSISTENCY CHECKER. You audit the INTERNAL coherence of a
single report along two dimensions:
  (1) CONTRADICTIONS — pairs of claims that assert conflicting values.
  (2) LOGICAL FLAWS — single claims that are presented as established but
      whose stated/cited support does not actually carry them.

Work only from the claims provided — do NOT use web search or any external
tool. Everything you assess is INTERNAL to the document — never judge whether
a claim is true in the world, only whether the document's own reasoning holds
together.

HARD CONSTRAINTS
  - Build a fact table in your reasoning (indicator/entity -> value list
    with claim ids) and compare numerical or temporal mismatches.
  - Final output MUST be a single JSON object matching this schema:
    {
      "contradictions": [
        {
          "claim_a_id": string (one of the input claim IDs),
          "claim_b_id": string (a different input claim ID),
          "severity": one of "critical"|"major"|"minor",
          "confidence": float in [0,1],
          "summary": string (2-3 sentences explaining the contradiction)
        }
      ],
      "logical_flaws": [
        {
          "claim_id": string (one of the input claim IDs),
          "type": one of "unsupported_inference"|"overreach",
          "severity": one of "critical"|"major"|"minor",
          "confidence": float in [0,1],
          "summary": string (2-3 sentences: why this step does not follow),
          "missing": string (the specific evidence or reasoning step that
                     would be needed for the claim to hold)
        }
      ]
    }
  - If nothing is found, return {"contradictions": [], "logical_flaws": []}.

CONTRADICTIONS
  - severity = "critical" iff the two claims directly assert opposing values
    for an identical indicator (e.g., 32% vs 28% margin).
  - severity = "major" iff the contradiction is on the same entity but
    different metric framings (e.g., GAAP vs non-GAAP).
  - severity = "minor" iff the claims merely sit in tension (e.g., one
    bullish sentence followed by a cautious caveat without an explicit
    numerical conflict).

LOGICAL FLAWS
  - "unsupported_inference": a conclusion is treated as following from the
    premises it cites/states, but it does not follow — OR its only support is
    a single unverified citation presented as if it settled the matter.
  - "overreach": a conclusion's STRENGTH or SCOPE exceeds what its cited data
    supports (e.g., one region's survey -> "global leader"; one quarter ->
    "permanent trend"; correlation stated as causation).
  - Every logical_flaw MUST include "missing" — the concrete evidence or
    reasoning step the document would need for the claim to hold. A flaw
    without a clear "missing" is not a flaw; drop it.
  - Be CONSERVATIVE — when in doubt, omit. Only flag claims that are presented
    as ALREADY SUPPORTED while the support is plainly insufficient. Do NOT
    flag ordinary opinions, hedged forecasts, or clearly-labelled assumptions
    ("we expect", "in our view", "if X holds"). Prefer fewer, high-confidence
    flaws over many speculative ones.

OUTPUT ONLY THE JSON OBJECT.
"""


class ContradictionPair(BaseModel):
    claim_a_id: str
    claim_b_id: str
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str


class LogicalFlaw(BaseModel):
    """A single claim whose stated support does not carry its conclusion.

    Pure document-internal judgement (no web access): either a conclusion that
    does not follow from its premises (`unsupported_inference`) or one whose
    strength/scope exceeds its cited data (`overreach`). `missing` names what
    the document would need for the claim to hold — the transparency hook.
    """

    claim_id: str
    type: Literal["unsupported_inference", "overreach"]
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    missing: str


class ConsistencyOutput(BaseModel):
    contradictions: list[ContradictionPair] = Field(default_factory=list)
    logical_flaws: list[LogicalFlaw] = Field(default_factory=list)


def build_consistency_input(claims: list[Claim]) -> str:
    """Serialise claim list as a JSON array with id/page/type/value highlights.

    We deliberately include only the fields the model needs - to keep input
    tokens manageable for long reports.
    """
    payload = [
        {
            "id": c.id,
            "page": c.page,
            "type": c.type.value,
            "text": c.text,
            "metadata": c.extracted_metadata,
        }
        for c in claims
    ]
    return (
        "Scan these claims for internal contradictions. Build a fact table "
        "and compare numerical / temporal values that "
        "should agree but don't. Skip purely qualitative restatements.\n"
        "Also flag logical flaws WITHIN a single claim: conclusions that don't "
        "follow from their stated/cited premises (unsupported_inference) or "
        "whose strength/scope exceeds their cited data (overreach). For each "
        "such flaw, state what evidence or step is MISSING. Be conservative.\n\n"
        f"CLAIMS:\n{json.dumps(payload, indent=2, ensure_ascii=False)}\n"
    )


async def check_consistency(
    claims: list[Claim],
    *,
    cheap_client: CheapLLMClient | None,
    miromind_client: MiromindClient,
) -> AgentResult[ConsistencyOutput]:
    # Internal-coherence checking uses no web search, so it runs on the cheap
    # LLM when configured (MiroMind fallback otherwise) — see complete_routed.
    return await complete_routed(
        cheap_client=cheap_client,
        miromind_client=miromind_client,
        system_prompt=SYSTEM_PROMPT,
        input_text=build_consistency_input(claims),
        model_cls=ConsistencyOutput,
        max_output_tokens=6000,
        agent_name="consistency",
    )
