"""Checkworthiness filter — classifies claims as worth verifying or not.

Uses a cheap LLM (DeepSeek) to filter out opinions, common knowledge,
and vague statements before expensive MiroMind verification.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.llm.cheap_client import CheapLLMClient
from argus.models.domain import Claim

SYSTEM_PROMPT = """\
You are a claim checkworthiness classifier. For each claim, decide whether
it is objectively verifiable using external sources.

Mark as checkworthy (true):
- Specific statistics, numbers, or percentages with cited sources
- Named citations (author, year, publication)
- Dated events or time-sensitive data points
- Quantitative comparisons between named entities

Mark as NOT checkworthy (false):
- Subjective opinions or value judgments
- Common knowledge facts that any reader would accept
- Vague or hedged statements ("some experts believe...", "it is likely...")
- Definitions or explanations of well-known concepts
- Forward-looking predictions without a verifiable basis

Return valid JSON matching the schema below.

Output schema:
{
  "results": [
    {
      "claim_id": "<id>",
      "checkworthy": true | false,
      "reason": "<brief reason, under 15 words>"
    }
  ]
}
"""


class CheckworthinessResult(BaseModel):
    class Item(BaseModel):
        claim_id: str
        checkworthy: bool = True
        reason: str = ""

    results: list[Item] = Field(default_factory=list)


async def run_checkworthiness(
    client: CheapLLMClient,
    claims: list[Claim],
) -> tuple[list[Claim], list[tuple[Claim, str]]]:
    """Returns (checkworthy_claims, filtered_claims_with_reasons)."""
    if not claims:
        return [], []

    import json
    payload = [{"id": c.id, "text": c.text, "type": c.type.value} for c in claims]
    user_input = (
        "Classify each claim as checkworthy or not.\n\n"
        f"CLAIMS:\n{json.dumps(payload, indent=2, ensure_ascii=False)}"
    )

    result = await client.complete(SYSTEM_PROMPT, user_input, CheckworthinessResult)

    verdict_map = {r.claim_id: r for r in result.results}
    claim_map = {c.id: c for c in claims}

    checkworthy: list[Claim] = []
    filtered: list[tuple[Claim, str]] = []

    for claim in claims:
        item = verdict_map.get(claim.id)
        if item and not item.checkworthy:
            filtered.append((claim, item.reason))
        else:
            checkworthy.append(claim)

    return checkworthy, filtered
