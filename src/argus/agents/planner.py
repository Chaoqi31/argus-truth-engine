"""Planner agent: extracts a list of typed Claims from a parsed PDF.

Plan A goal: produce Claims of type=citation reliably. Other types are
allowed but not heavily prompt-engineered yet; Plan B refines.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, ClaimType
from argus.pdf.parser import ParsedDoc

_VALID_CLAIM_TYPES: set[str] = {ct.value for ct in ClaimType}

SYSTEM_PROMPT = """\
You are Argus's PLANNER agent. Your only task is to extract verifiable factual
claims from an investment-research PDF.

You may use these built-in tools: thinking, execute_python.
You SHOULD NOT call web_search or fetch_url_content — that is the next agent's job.

HARD CONSTRAINTS
  - Output MUST be a single valid JSON object — no prose, no fences, no comments,
    no trailing commas inside arrays or objects.
  - Schema:
    {
      "claims": [
        {
          "id": "c1",
          "text": "the exact sentence as it appears in the PDF",
          "page": 1,
          "span": [69, 116],
          "type": "citation",
          "importance": "high",
          "extracted_metadata": {"authors": ["Smith"], "year": 2021}
        }
      ]
    }
  - `span` MUST be a JSON array of EXACTLY TWO non-negative integers
    [start_char_offset, end_char_offset] within that page's text.
    Both numbers MUST be present. If you cannot determine an exact end offset,
    use start + len(text). NEVER emit `[27,]` or `[27]` — both are invalid.
  - `type` MUST be exactly one of: "citation", "numerical-data", "time-sensitive",
    "cross-reference", "qualitative".
  - `importance` MUST be exactly one of: "high", "medium", "low".
  - Only emit verifiable factual claims. Skip opinion / outlook / generic boilerplate.
  - For type="citation", extracted_metadata SHOULD include any of
    {authors: list[string], year: int, title: string, doi: string|null}.

OUTPUT ONLY THE JSON OBJECT.
"""


class _RawClaim(BaseModel):
    """Lenient planner-side claim shape that tolerates LLM output quirks.

    Real MiroMind output occasionally emits empty or unrecognised values for
    the strict-enum fields ``type`` and ``importance``. We coerce those to
    safe defaults rather than failing the whole run — the verdict severity
    that the audit ultimately produces is what matters, not the planner's
    importance label.
    """

    id: str
    text: str
    page: int = Field(ge=1)
    span: list[int] | None = None  # accept anything; we normalise downstream
    type: ClaimType = ClaimType.QUALITATIVE
    importance: Literal["high", "medium", "low"] = "low"
    extracted_metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("type", mode="before")
    @classmethod
    def _coerce_type(cls, v: object) -> object:
        if isinstance(v, str) and v not in _VALID_CLAIM_TYPES:
            return ClaimType.QUALITATIVE
        return v

    @field_validator("importance", mode="before")
    @classmethod
    def _coerce_importance(cls, v: object) -> object:
        if not isinstance(v, str) or v not in {"high", "medium", "low"}:
            return "low"
        return v


class PlannerOutput(BaseModel):
    """Raw planner output. Call `to_claims()` to get strict-validated Claims."""

    claims: list[_RawClaim] = Field(default_factory=list)

    def to_claims(self) -> list[Claim]:
        """Convert relaxed planner output to strict-validated Claim instances.

        Spans that are missing, malformed, or out of order fall back to (0, 0).
        The downstream Citation Verifier doesn't need the span for its work;
        the span is mainly for future UI highlighting in Plan C.
        """
        out: list[Claim] = []
        for raw in self.claims:
            span = _coerce_span(raw.span)
            out.append(
                Claim(
                    id=raw.id,
                    text=raw.text,
                    page=raw.page,
                    span=span,
                    type=raw.type,
                    importance=raw.importance,
                    extracted_metadata=raw.extracted_metadata,
                )
            )
        return out


_SPAN_LEN = 2


def _coerce_span(value: list[int] | None) -> tuple[int, int]:
    if value is None or len(value) < _SPAN_LEN:
        return (0, 0)
    start, end = int(value[0]), int(value[1])
    if start < 0 or end < start:
        return (0, 0)
    return (start, end)


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
