"""Claim atomizer — splits coarse planner claims into atomic verifiable facts.

Uses a cheap LLM (DeepSeek) instead of MiroMind to keep costs near zero.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.llm.cheap_client import CheapLLMClient
from argus.models.domain import Claim, ClaimType

SYSTEM_PROMPT = """\
You are a claim decomposition specialist. Your task is to break compound
factual claims into atomic, independently verifiable facts.

Rules:
- Each atomic fact must be a single, self-contained statement under 20 words.
- Preserve the original meaning exactly — do not infer or add information.
- Keep named entities, numbers, dates, and citations intact.
- If a claim is already atomic, return it unchanged.
- Assign each atom the most specific type from: citation, numerical-data,
  time-sensitive, cross-reference, qualitative.
- Return valid JSON matching the schema below.

Output schema:
{
  "atoms": [
    {
      "parent_claim_id": "<id of the original claim>",
      "text": "<atomic fact, under 20 words>",
      "type": "citation | numerical-data | time-sensitive | cross-reference | qualitative"
    }
  ]
}
"""


class AtomOutput(BaseModel):
    class Atom(BaseModel):
        parent_claim_id: str
        text: str
        type: str = "qualitative"

    atoms: list[Atom] = Field(default_factory=list)


_TYPE_MAP: dict[str, ClaimType] = {
    "citation": ClaimType.CITATION,
    "numerical-data": ClaimType.NUMERICAL_DATA,
    "time-sensitive": ClaimType.TIME_SENSITIVE,
    "cross-reference": ClaimType.CROSS_REFERENCE,
    "qualitative": ClaimType.QUALITATIVE,
}


async def run_atomizer(
    client: CheapLLMClient,
    claims: list[Claim],
) -> list[Claim]:
    if not claims:
        return []

    payload = [
        {"id": c.id, "text": c.text, "type": c.type.value}
        for c in claims
    ]
    import json
    user_input = (
        "Decompose each claim into atomic verifiable facts.\n\n"
        f"CLAIMS:\n{json.dumps(payload, indent=2, ensure_ascii=False)}"
    )

    result = await client.complete(SYSTEM_PROMPT, user_input, AtomOutput)

    parent_map = {c.id: c for c in claims}
    atoms: list[Claim] = []
    for i, atom in enumerate(result.atoms):
        parent = parent_map.get(atom.parent_claim_id)
        if not parent:
            continue
        claim_type = _TYPE_MAP.get(atom.type, parent.type)
        atoms.append(
            Claim(
                id=f"a_{i+1}",
                text=atom.text,
                page=parent.page,
                span=parent.span,
                type=claim_type,
                importance=parent.importance,
                extracted_metadata=parent.extracted_metadata,
                parent_claim_id=parent.id,
            )
        )

    return atoms if atoms else claims
