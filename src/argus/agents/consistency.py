"""Consistency Checker agent: find self-contradicting claim pairs in one document."""
from __future__ import annotations

import json

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, Severity

SYSTEM_PROMPT = """\
You are Argus's CONSISTENCY CHECKER. Your only task is to find pairs of claims
from the SAME report that contradict each other.

You MAY use these built-in tools: thinking, execute_python.
You MUST NOT use web_search or fetch_url_content. The contradictions you are
looking for are INTERNAL to the document.

HARD CONSTRAINTS
  - Use execute_python to build a fact table (indicator/entity -> value list
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
      ]
    }
  - If no contradictions are found, return {"contradictions": []}.
  - severity = "critical" iff the two claims directly assert opposing values
    for an identical indicator (e.g., 32% vs 28% margin).
  - severity = "major" iff the contradiction is on the same entity but
    different metric framings (e.g., GAAP vs non-GAAP).
  - severity = "minor" iff the claims merely sit in tension (e.g., one
    bullish sentence followed by a cautious caveat without an explicit
    numerical conflict).

OUTPUT ONLY THE JSON OBJECT.
"""


class ContradictionPair(BaseModel):
    claim_a_id: str
    claim_b_id: str
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str


class ConsistencyOutput(BaseModel):
    contradictions: list[ContradictionPair] = Field(default_factory=list)


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
        "with execute_python and compare numerical / temporal values that "
        "should agree but don't. Skip purely qualitative restatements.\n\n"
        f"CLAIMS:\n{json.dumps(payload, indent=2, ensure_ascii=False)}\n"
    )


def consistency_runner(client: MiromindClient) -> AgentRunner[ConsistencyOutput]:
    return AgentRunner(
        client=client,
        model_cls=ConsistencyOutput,
        agent_name="consistency",
        max_output_tokens=6000,
    )


async def check_consistency(
    client: MiromindClient, claims: list[Claim]
) -> AgentResult[ConsistencyOutput]:
    runner = consistency_runner(client)
    return await runner.run(
        instructions=SYSTEM_PROMPT, input_text=build_consistency_input(claims)
    )
