"""Evidence Hunter — multi-strategy search planner.

For each claim, generates 2-3 search strategies from different angles:
  - Direct verification (search for the exact claim)
  - Negation/contradiction search (search for counter-evidence)
  - Source tracing (find the original source of the claim)

Uses DeepSeek (cheap) to plan strategies; MiroMind specialists then execute.
This is OUR methodology layer — not MiroMind's black box.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.llm.cheap_client import CheapLLMClient
from argus.log import log
from argus.models.domain import Claim, SearchStrategy

_BASE_SYSTEM_PROMPT = """\
You are a search strategy planner for fact-checking. Given a claim, generate
2-3 distinct search strategies to verify it. Each strategy attacks the claim
from a DIFFERENT angle.

ANGLES to consider:
1. DIRECT_VERIFICATION — search for the exact fact to confirm it
2. NEGATION_SEARCH — search for evidence that contradicts the claim
3. SOURCE_TRACING — find the original publication/dataset the claim comes from
4. CROSS_REFERENCE — find independent sources that discuss the same topic
5. TEMPORAL_CHECK — find the most recent data to check if the claim is outdated

RULES:
- Generate exactly 2-3 strategies (not more, not fewer)
- Each query should be a realistic web search query (like you'd type into Google)
- The rationale should explain why this angle helps verify the claim
- Prefer authoritative sources (academic, government, official)
{domain_guidance}
Output JSON:
{{
  "strategies": [
    {{"angle": "...", "query": "...", "rationale": "..."}},
    ...
  ]
}}
"""

# Domain-specific source guidance injected into the prompt
_DOMAIN_GUIDANCE: dict[str, str] = {
    "general": "",
    "academic": (
        "\nDOMAIN: Academic research. Prioritize:\n"
        "- Google Scholar, Semantic Scholar, PubMed, arXiv, SSRN\n"
        "- University institutional repositories\n"
        "- DOI lookups and citation counts for verification\n"
    ),
    "medical": (
        "\nDOMAIN: Medical/health. Prioritize:\n"
        "- PubMed, Cochrane Library, WHO publications\n"
        "- NIH (nih.gov), CDC (cdc.gov), FDA (fda.gov)\n"
        "- Clinical trial registries (clinicaltrials.gov)\n"
        "- Peer-reviewed medical journals (NEJM, Lancet, BMJ, JAMA)\n"
        "- Be extra cautious: medical misinformation can cause harm\n"
    ),
    "legal": (
        "\nDOMAIN: Legal. Prioritize:\n"
        "- Official court records, case law databases\n"
        "- Government legislation sites (.gov)\n"
        "- Legal journals and law review articles\n"
        "- Bar association and regulatory body publications\n"
    ),
    "finance": (
        "\nDOMAIN: Finance/economics. Prioritize:\n"
        "- SEC EDGAR, FRED (Federal Reserve), World Bank Open Data, IMF\n"
        "- Company filings (10-K, 10-Q, annual reports)\n"
        "- Bloomberg, Reuters for market data verification\n"
        "- Central bank publications for monetary policy claims\n"
    ),
    "technology": (
        "\nDOMAIN: Technology. Prioritize:\n"
        "- Official documentation and changelogs\n"
        "- GitHub repositories and release notes\n"
        "- Vendor/company press releases and blog posts\n"
        "- Industry benchmarks and technical specifications\n"
    ),
    "news": (
        "\nDOMAIN: News/current events. Prioritize:\n"
        "- Major wire services (AP, Reuters, AFP)\n"
        "- Cross-reference across multiple independent news outlets\n"
        "- Official government/institutional press releases\n"
        "- Fact-checking organizations (Snopes, PolitiFact, FactCheck.org)\n"
    ),
    "science": (
        "\nDOMAIN: Science. Prioritize:\n"
        "- Peer-reviewed journals (Nature, Science, PNAS)\n"
        "- Preprint servers (arXiv, bioRxiv, medRxiv)\n"
        "- Research institution publications\n"
        "- Replication studies and meta-analyses\n"
        "- Scientific databases (NASA, NOAA, CERN)\n"
    ),
}


def _build_system_prompt(content_domain: str) -> str:
    guidance = _DOMAIN_GUIDANCE.get(content_domain, "")
    return _BASE_SYSTEM_PROMPT.format(domain_guidance=guidance)


class StrategyItem(BaseModel):
    angle: str
    query: str
    rationale: str


class StrategyOutput(BaseModel):
    strategies: list[StrategyItem] = Field(min_length=1, max_length=5)


async def plan_search_strategies(
    client: CheapLLMClient,
    claims: list[Claim],
    content_domain: str = "general",
) -> dict[str, list[SearchStrategy]]:
    """Plan search strategies for a batch of claims.

    Returns a dict mapping claim_id -> list of SearchStrategy objects.
    Processes claims in one batch call for efficiency.
    The content_domain parameter injects domain-specific source guidance.
    """
    if not claims:
        return {}

    system_prompt = _build_system_prompt(content_domain)

    # Batch all claims into one prompt for efficiency
    claims_text = "\n".join(
        f"[{c.id}] {c.text}" for c in claims
    )
    user_input = (
        f"Plan search strategies for each of these {len(claims)} claims:\n\n"
        f"{claims_text}\n\n"
        "Output a JSON object with a top-level key for each claim ID:\n"
        '{"<claim_id>": {"strategies": [...]}, ...}'
    )

    # For large batches, process individually to avoid context overflow
    if len(claims) > 10:
        return await _plan_individually(client, claims, system_prompt)

    try:
        result = await client.complete(
            system_prompt=system_prompt,
            user_input=user_input,
            model_cls=_BatchOutput,
        )
        return _parse_batch_result(result, claims)
    except Exception as exc:
        log.warning("evidence_hunter.batch_failed", error=str(exc)[:200])
        # Fallback: process individually
        return await _plan_individually(client, claims, system_prompt)


async def _plan_individually(
    client: CheapLLMClient, claims: list[Claim], system_prompt: str
) -> dict[str, list[SearchStrategy]]:
    """Fallback: plan strategies one claim at a time."""
    result: dict[str, list[SearchStrategy]] = {}
    for claim in claims:
        try:
            output = await client.complete(
                system_prompt=system_prompt,
                user_input=f"Claim to verify: {claim.text}",
                model_cls=StrategyOutput,
            )
            result[claim.id] = [
                SearchStrategy(
                    angle=s.angle, query=s.query, rationale=s.rationale
                )
                for s in output.strategies
            ]
        except Exception as exc:
            log.warning("evidence_hunter.claim_failed",
                        claim_id=claim.id, error=str(exc)[:200])
            # Default strategy: just search the claim directly
            result[claim.id] = [
                SearchStrategy(
                    angle="direct_verification",
                    query=claim.text,
                    rationale="Fallback: search the claim text directly",
                )
            ]
    return result


class _BatchOutput(BaseModel):
    """Flexible batch output — accepts dict of claim_id -> strategies."""

    class Config:
        extra = "allow"


def _parse_batch_result(
    result: _BatchOutput, claims: list[Claim]
) -> dict[str, list[SearchStrategy]]:
    """Parse batch result, handling various output shapes."""
    out: dict[str, list[SearchStrategy]] = {}
    raw = result.model_dump()

    for claim in claims:
        claim_data = raw.get(claim.id, {})
        if not claim_data or not isinstance(claim_data, dict):
            # Fallback
            out[claim.id] = [
                SearchStrategy(
                    angle="direct_verification",
                    query=claim.text,
                    rationale="Fallback: search the claim text directly",
                )
            ]
            continue

        strategies_raw = claim_data.get("strategies", [])
        strategies: list[SearchStrategy] = []
        for s in strategies_raw:
            if isinstance(s, dict):
                strategies.append(SearchStrategy(
                    angle=s.get("angle", "direct_verification"),
                    query=s.get("query", claim.text),
                    rationale=s.get("rationale", ""),
                ))
        out[claim.id] = strategies or [
            SearchStrategy(
                angle="direct_verification",
                query=claim.text,
                rationale="Fallback",
            )
        ]
    return out
