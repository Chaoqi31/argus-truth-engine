"""Citation Verifier agent: confirms whether a cited work actually exists."""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, EvidenceSource, FindingVerdict

SYSTEM_PROMPT = """\
You are Argus's CITATION VERIFIER. Your only task is to determine whether a
cited work referenced in the given content actually exists.

You MAY use these built-in tools: thinking, web_search, fetch_url_content,
execute_python. You MUST consult authoritative sources.

HARD CONSTRAINTS
  - For any DOI/journal candidate, you MUST first call
    fetch_url_content("https://api.crossref.org/works?query.bibliographic=<title>&query.author=<author>")
    and inspect the JSON.
  - If Crossref returns no match, try arXiv, then SSRN, then Google Scholar via web_search,
    in that order. You MUST exhaust AT LEAST THREE distinct authoritative
    sources before concluding.
  - When NO source can be located after exhaustive search, the verdict MUST be
    "fabricated" (NOT "uncertain"). Reserve "uncertain" only for transient
    failures (timeouts, rate limits) where you could not actually finish
    checking — name the failure mode in the summary.
  - You MUST provide a step-by-step reasoning_chain showing your verification
    logic. Each step must clearly state what you checked and what you found.
  - Final output MUST be a single JSON object exactly matching this schema:
    {
      "verdict": one of "ok"|"fabricated"|"partial-match"|"uncertain",
      "confidence": float in [0,1],
      "summary": string (2-4 sentences explaining the verdict),
      "evidence": [
        { "source_type": one of "crossref"|"arxiv"|"ssrn"|"web_page"|"wikipedia",
          "url": string|null,
          "snippet": string }
      ],
      "reasoning_chain": [
        { "step": "premise|search|evidence_found|comparison|inference",
          "content": "what you did and what you found",
          "evidence_ref": "url or null",
          "confidence_delta": float (how this step changed your confidence) }
      ]
    }
  - Provide at least 1 evidence item even when the verdict is "fabricated"
    (the evidence then represents the absence — e.g., the empty Crossref result).
  - The reasoning_chain must have at least 3 steps.
OUTPUT ONLY THE JSON OBJECT.
"""


class EvidenceOut(BaseModel):
    source_type: EvidenceSource
    url: str | None = None
    snippet: str = ""


class ReasoningStepOut(BaseModel):
    step: str  # premise, search, evidence_found, comparison, inference
    content: str
    evidence_ref: str | None = None
    confidence_delta: float = 0.0


class CitationVerifierOutput(BaseModel):
    verdict: FindingVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    evidence: list[EvidenceOut] = Field(default_factory=list)
    reasoning_chain: list[ReasoningStepOut] = Field(default_factory=list)


def build_verifier_input(
    claim: Claim,
    *,
    surrounding: str = "",
    search_strategies: list[dict[str, str]] | None = None,
) -> str:
    md = claim.extracted_metadata or {}
    parts = [
        "Verify whether this citation refers to a real published work.\n\n"
        f"CLAIM (page {claim.page}): {claim.text}\n"
        f"SURROUNDING TEXT: {surrounding}\n"
        f"EXTRACTED METADATA: {md}\n\n"
    ]
    if search_strategies:
        parts.append("REQUIRED SEARCH PLAN (you MUST execute these searches):\n")
        for i, s in enumerate(search_strategies, 1):
            parts.append(f"  {i}. [{s.get('angle','')}] {s.get('query','')}"
                         f"  (rationale: {s.get('rationale','')})\n")
        parts.append("\nExecute ALL planned searches above, THEN any additional "
                     "searches you deem necessary.\n\n")
    parts.append(
        "If you can find a DOI, return it in your summary. "
        "If no source can be located after a real Crossref + Scholar search, "
        'verdict MUST be "fabricated" with confidence reflecting how thoroughly you searched.'
    )
    return "".join(parts)


def verifier_runner(client: MiromindClient) -> AgentRunner[CitationVerifierOutput]:
    return AgentRunner(
        client=client,
        model_cls=CitationVerifierOutput,
        agent_name="citation_verifier",
        max_output_tokens=4000,
    )


async def verify_citation(
    client: MiromindClient,
    claim: Claim,
    *,
    surrounding: str = "",
    search_strategies: list[dict[str, str]] | None = None,
) -> AgentResult[CitationVerifierOutput]:
    runner = verifier_runner(client)
    return await runner.run(
        instructions=SYSTEM_PROMPT,
        input_text=build_verifier_input(
            claim, surrounding=surrounding, search_strategies=search_strategies
        ),
    )
