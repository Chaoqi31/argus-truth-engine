"""Citation Alignment agent: verify the report's paraphrase matches the source."""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, EvidenceSource, FindingVerdict

SYSTEM_PROMPT = """\
You are Argus's CITATION ALIGNMENT agent. For a citation in the given content,
your job is to determine whether the content's paraphrase or quote actually
matches what the cited source says.

You MAY use these built-in tools: thinking, web_search, fetch_url_content,
execute_python.

HARD CONSTRAINTS
  - You MUST attempt to fetch the actual source document via AT LEAST THREE
    distinct authoritative routes (DOI URL, Crossref API, arXiv, SSRN,
    publisher / journal page found via web_search) before falling back to an
    inconclusive verdict.
  - You MAY use execute_python to extract or align relevant paragraphs from the
    fetched text.
  - VERDICT ESCALATION RULES (apply IN ORDER):
      a. If you successfully retrieved the source and the report's wording does
         not match → verdict ∈ {"mismatch","misrepresented","partial-match"}.
      b. If after ≥3 distinct authoritative attempts the source returns
         persistent 404 / "no match" / does not appear in any scholarly index
         (Crossref, arXiv, SSRN, publisher) → this is STRONG evidence the cited
         work does not exist. Verdict MUST be "fabricated" with confidence
         ≥0.75 and the summary MUST list each route attempted and its result.
      c. Reserve "uncertain" ONLY for transient failures (network timeouts,
         rate limits, paywalls you couldn't bypass) where the absence is
         inconclusive — explain WHY it's transient.
  - Final output MUST be a single JSON object matching this schema:
    {
      "verdict": one of "ok"|"partial-match"|"mismatch"|"misrepresented"|"fabricated"|"uncertain",
      "confidence": float in [0,1],
      "summary": string (2-4 sentences contrasting the report's wording with
                         the source's wording, OR enumerating the retrieval
                         attempts when fabricated),
      "evidence": [
        { "source_type": one of "crossref"|"arxiv"|"ssrn"|"web_page"|"company_filing",
          "url": string|null,
          "snippet": string (the matching/non-matching passage from the source,
                             OR the empty/404 response when fabricated) }
      ]
    }
  - "ok" means the report accurately conveys the source's claim.
  - "partial-match" means the report paraphrases but adds nuance or omits caveats.
  - "mismatch" means the report attributes a claim the source does not make.
  - "misrepresented" means the report inverts or distorts the source's claim.
  - "fabricated" means the cited work itself does not appear to exist in any
    authoritative scholarly index after exhaustive search.

OUTPUT ONLY THE JSON OBJECT.
"""


class EvidenceOut(BaseModel):
    source_type: EvidenceSource
    url: str | None = None
    snippet: str = ""


class CitationAlignmentOutput(BaseModel):
    verdict: FindingVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    evidence: list[EvidenceOut] = Field(default_factory=list)


def build_alignment_input(claim: Claim, *, surrounding: str = "") -> str:
    md = claim.extracted_metadata or {}
    doi = md.get("doi")
    return (
        "Compare the report's wording to what the cited source actually says.\n\n"
        f"CLAIM (page {claim.page}): {claim.text}\n"
        f"SURROUNDING TEXT: {surrounding}\n"
        f"EXTRACTED METADATA: {md}\n"
        f"DOI (if any): {doi}\n\n"
        "First retrieve the source. Then compare paragraph-by-paragraph and "
        "issue a verdict from the allowed set."
    )


def alignment_runner(client: MiromindClient) -> AgentRunner[CitationAlignmentOutput]:
    return AgentRunner(
        client=client,
        model_cls=CitationAlignmentOutput,
        agent_name="citation_alignment",
        max_output_tokens=4000,
    )


async def check_alignment(
    client: MiromindClient,
    claim: Claim,
    *,
    surrounding: str = "",
) -> AgentResult[CitationAlignmentOutput]:
    runner = alignment_runner(client)
    return await runner.run(
        instructions=SYSTEM_PROMPT,
        input_text=build_alignment_input(claim, surrounding=surrounding),
    )
