"""Claim atomizer — splits coarse planner claims into atomic verifiable facts.

Uses a cheap LLM (DeepSeek) instead of MiroMind to keep costs near zero.
"""
from __future__ import annotations

import json

from pydantic import BaseModel, Field

from argus.llm import Route, Task
from argus.models.domain import Agent, Claim, ClaimType

SYSTEM_PROMPT = """\
You are a claim decomposition specialist. Your task is to break compound
factual claims into atomic, independently verifiable facts.

Rules:
- Each atomic fact must be a single, self-contained statement under 20 words.
- Only split a claim when it genuinely contains MULTIPLE distinct,
  independently-checkable facts. Never split a single fact into pieces.
- Prefer the FEWEST atoms that capture the material, check-worthy claims.
  As a rule of thumb emit at most ~2 atoms per input claim.
- Do NOT emit atoms for opinions, forecasts, recommendations, ratings, price
  targets, or hedged statements ("we expect", "in our view", "we forecast",
  "we model") — those are not externally verifiable facts.
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


ATOMIZE = Task(
    agent=Agent.ATOMIZER,
    route=Route.DEEPSEEK_ONLY,
    instructions=SYSTEM_PROMPT,
    output=AtomOutput,
    max_output_tokens=4000,
)


def build_atomizer_input(claims: list[Claim]) -> str:
    payload = [{"id": c.id, "text": c.text, "type": c.type.value} for c in claims]
    return (
        "Decompose each claim into atomic verifiable facts.\n\n"
        f"CLAIMS:\n{json.dumps(payload, indent=2, ensure_ascii=False)}"
    )


def atoms_from(output: AtomOutput, claims: list[Claim]) -> list[Claim]:
    """Atoms as claims that inherit their parent's page, span and importance.
    Falls back to the original claims when no atom maps to a parent."""
    parent_map = {c.id: c for c in claims}
    atoms: list[Claim] = []
    for i, atom in enumerate(output.atoms):
        parent = parent_map.get(atom.parent_claim_id)
        if not parent:
            continue
        atoms.append(
            Claim(
                id=f"a_{i+1}",
                text=atom.text,
                page=parent.page,
                span=parent.span,
                type=_TYPE_MAP.get(atom.type, parent.type),
                importance=parent.importance,
                extracted_metadata=parent.extracted_metadata,
                parent_claim_id=parent.id,
            )
        )
    return atoms if atoms else claims
