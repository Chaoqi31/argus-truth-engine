"""Planner agent: extracts a list of typed Claims from a parsed PDF.

Plan A goal: produce Claims of type=citation reliably. Other types are
allowed but not heavily prompt-engineered yet; Plan B refines.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim
from argus.pdf.parser import ParsedDoc

SYSTEM_PROMPT = """\
You are Argus's PLANNER agent. Your only task is to extract verifiable factual
claims from an investment-research PDF.

You may use these built-in tools: thinking, execute_python.
You SHOULD NOT call web_search or fetch_url_content — that is the next agent's job.

HARD CONSTRAINTS
  - Output must be valid JSON exactly matching this schema:
    {
      "claims": [
        {
          "id": string,
          "text": string,
          "page": integer (>=1),
          "span": [start: int, end: int],
          "type": one of "citation"|"numerical-data"|"time-sensitive"
                   |"cross-reference"|"qualitative",
          "importance": one of "high"|"medium"|"low",
          "extracted_metadata": object
        }
      ]
    }
  - Only emit verifiable factual claims; drop opinion / outlook sentences.
  - For type="citation", extracted_metadata SHOULD include any of
    {authors: list[string], year: int, title: string, doi: string|null}.
  - Each claim's `page` MUST match a "[PAGE N]" marker in the input.
  - Each claim's `span` MUST be character offsets within that page's text.

OUTPUT ONLY THE JSON OBJECT. No prose, no fences, no comments.
"""


class PlannerOutput(BaseModel):
    claims: list[Claim] = Field(default_factory=list)


def build_planner_input(doc: ParsedDoc) -> str:
    """Concatenate pages with explicit page markers the model can cite back."""
    parts = [f"[PAGE {p.page_number}]\n{p.text}" for p in doc.pages]
    return "\n\n".join(parts)


def planner_runner(client: MiromindClient) -> AgentRunner[PlannerOutput]:
    return AgentRunner(
        client=client,
        model_cls=PlannerOutput,
        agent_name="planner",
        max_output_tokens=12000,
    )


async def run_planner(
    client: MiromindClient, doc: ParsedDoc
) -> AgentResult[PlannerOutput]:
    runner = planner_runner(client)
    return await runner.run(
        instructions=SYSTEM_PROMPT, input_text=build_planner_input(doc)
    )
