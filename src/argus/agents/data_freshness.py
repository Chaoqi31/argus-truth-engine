"""Data Freshness agent: check whether a data point is still the latest."""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.agents.base import AgentResult, AgentRunner
from argus.miromind.client import MiromindClient
from argus.models.domain import Claim, EvidenceSource, FindingVerdict

SYSTEM_PROMPT = """\
You are Argus's DATA FRESHNESS agent. For a numerical or time-sensitive claim
in a research report, your job is to determine whether the value is the latest
available figure or has been superseded by a newer release.

You MAY use these built-in tools: thinking, web_search, fetch_url_content,
execute_python. You MUST consult authoritative sources:

  * Macro indicators (GDP, CPI, unemployment, trade) -> FRED API
    (https://api.stlouisfed.org/), the World Bank API
    (https://api.worldbank.org/v2/), or IMF Data (https://www.imf.org/en/Data).
  * Company financials (revenue, EPS, margin, etc.) -> SEC EDGAR
    (https://data.sec.gov/) and look for the most recent 10-Q / 10-K filing.
  * Industry statistics (market size, shipments) -> the original publisher.

HARD CONSTRAINTS
  - You MUST fetch the authoritative source and quote the newest value before
    issuing a non-uncertain verdict.
  - Final output MUST be a single JSON object matching this schema:
    {
      "verdict": one of "ok"|"stale"|"superseded"|"uncertain",
      "confidence": float in [0,1],
      "summary": string (2-4 sentences contrasting the report's value with
                         the current value),
      "as_of_date": string|null (date of the report's figure, e.g. "Q2 2025"),
      "current_value": string|null (the latest authoritative value, with unit),
      "evidence": [
        { "source_type": one of "fred"|"worldbank"|"imf"|"sec_edgar"|"company_filing"|"web_page",
          "url": string|null,
          "snippet": string }
      ]
    }
  - "ok" means the report's value matches the latest release.
  - "stale" means a newer release exists; the value is no longer current.
  - "superseded" means the value was REVISED in a later release; the report's
    number is now factually wrong.

OUTPUT ONLY THE JSON OBJECT.
"""


class EvidenceOut(BaseModel):
    source_type: EvidenceSource
    url: str | None = None
    snippet: str = ""


class DataFreshnessOutput(BaseModel):
    verdict: FindingVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    as_of_date: str | None = None
    current_value: str | None = None
    evidence: list[EvidenceOut] = Field(default_factory=list)


def build_freshness_input(claim: Claim) -> str:
    md = claim.extracted_metadata or {}
    return (
        "Verify whether this data point is still the latest authoritative "
        "value. Use FRED, World Bank, IMF, or SEC EDGAR as appropriate.\n\n"
        f"CLAIM (page {claim.page}): {claim.text}\n"
        f"EXTRACTED METADATA: {md}\n\n"
        "Fetch the authoritative source and quote the current value before "
        "issuing a verdict from the allowed set."
    )


def freshness_runner(client: MiromindClient) -> AgentRunner[DataFreshnessOutput]:
    return AgentRunner(
        client=client,
        model_cls=DataFreshnessOutput,
        agent_name="data_freshness",
        max_output_tokens=4000,
    )


async def check_freshness(
    client: MiromindClient, claim: Claim
) -> AgentResult[DataFreshnessOutput]:
    runner = freshness_runner(client)
    return await runner.run(
        instructions=SYSTEM_PROMPT, input_text=build_freshness_input(claim)
    )
