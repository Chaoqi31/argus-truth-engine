"""Reporter agent: synthesise all findings into a ranked summary."""
from __future__ import annotations

import json

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, Finding

SYSTEM_PROMPT = """\
You are Argus's REPORTER. The four specialist agents have finished. Your job
is to synthesise their findings into a ranked list and a short executive
summary for a buy-side analyst.

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
    finding_payload = [
        {
            "id": f.id,
            "claim_id": f.claim_id,
            "agent": f.agent,
            "verdict": f.verdict.value,
            "severity": f.severity.value,
            "confidence": f.confidence,
            "summary": f.summary,
        }
        for f in findings
    ]
    return (
        "Synthesise the findings below into a ranked list and an executive "
        "summary for a buy-side analyst.\n\n"
        f"CLAIMS:\n{json.dumps(claim_payload, indent=2, ensure_ascii=False)}\n\n"
        f"FINDINGS:\n{json.dumps(finding_payload, indent=2, ensure_ascii=False)}\n"
    )


def reporter_runner(client: MiromindClient) -> AgentRunner[ReporterOutput]:
    return AgentRunner(
        client=client,
        model_cls=ReporterOutput,
        agent_name="reporter",
        max_output_tokens=3000,
    )


async def run_reporter(
    client: MiromindClient,
    claims: list[Claim],
    findings: list[Finding],
) -> AgentResult[ReporterOutput]:
    runner = reporter_runner(client)
    return await runner.run(
        instructions=SYSTEM_PROMPT, input_text=build_reporter_input(claims, findings)
    )
