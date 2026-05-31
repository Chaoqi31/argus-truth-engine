"""Reporter agent: synthesise all findings into a ranked summary."""
from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, complete_routed
from argus.llm.cheap_client import CheapLLMClient
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, Finding

SYSTEM_PROMPT = """\
You are Argus's REPORTER. The verification agents have finished. Your job
is to synthesise their findings into a ranked list and a short executive
summary for the audit's reader — a compliance officer, lawyer, or analyst
who needs to act on this content within the next hour.

When a finding includes "why_wrong" and "correct_information", incorporate
these into the summary so the reader understands both what is wrong AND
what the correct answer is.

You MUST NOT call web_search, fetch_url_content, or execute_python. Your
input already contains everything you need.

HARD CONSTRAINTS
  - Rank findings first by severity (critical > major > minor), then by
    confidence (highest first).
  - The executive summary MUST:
      * be 3-6 sentences,
      * lead with the headline risk if there is one (any critical finding,
        or three or more major findings),
      * mention the report's strongest verified claims (any "ok" verdicts)
        as a counterweight,
      * be plain Markdown (use **bold** sparingly, bulleted lists only when
        listing distinct items),
      * NEVER invent findings or evidence that are not in the input.
  - Final output MUST be a single JSON object matching this schema:
    {
      "executive_summary_md": string,
      "ranked_finding_ids": [string, ...]
    }
  - The ranked_finding_ids array MUST be a permutation of the input
    findings' IDs (no additions, no omissions).

OUTPUT ONLY THE JSON OBJECT.
"""


class ReporterOutput(BaseModel):
    executive_summary_md: str
    ranked_finding_ids: list[str] = Field(default_factory=list)


def build_reporter_input(claims: list[Claim], findings: list[Finding]) -> str:
    claim_payload = [
        {"id": c.id, "page": c.page, "text": c.text, "type": c.type.value}
        for c in claims
    ]
    finding_payload = []
    for f in findings:
        entry: dict[str, Any] = {
            "id": f.id,
            "claim_id": f.claim_id,
            "agent": f.agent,
            "verdict": f.verdict.value,
            "severity": f.severity.value,
            "confidence": f.confidence,
            "summary": f.summary,
        }
        if f.why_wrong:
            entry["why_wrong"] = f.why_wrong
        if f.correct_information:
            entry["correct_information"] = {
                "value": f.correct_information.value,
                "source": f.correct_information.source,
                "url": f.correct_information.url,
            }
        finding_payload.append(entry)
    return (
        "Synthesise the findings below into a ranked list and an executive "
        "summary for the audit's reader.\n\n"
        f"CLAIMS:\n{json.dumps(claim_payload, indent=2, ensure_ascii=False)}\n\n"
        f"FINDINGS:\n{json.dumps(finding_payload, indent=2, ensure_ascii=False)}\n"
    )


async def run_reporter(
    claims: list[Claim],
    findings: list[Finding],
    *,
    cheap_client: CheapLLMClient | None,
    miromind_client: MiromindClient,
) -> AgentResult[ReporterOutput]:
    # Report synthesis needs no web search, so it runs on the cheap LLM when
    # configured (MiroMind fallback otherwise) — see complete_routed.
    return await complete_routed(
        cheap_client=cheap_client,
        miromind_client=miromind_client,
        system_prompt=SYSTEM_PROMPT,
        input_text=build_reporter_input(claims, findings),
        model_cls=ReporterOutput,
        max_output_tokens=3000,
        agent_name="reporter",
    )
