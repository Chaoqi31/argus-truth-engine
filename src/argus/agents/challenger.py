"""Adversarial Debate Protocol — 3-round structured debate for each finding.

Architecture (per finding):
  Round 1 - ATTACKER: tries to poke holes in the verdict
  Round 2 - DEFENDER: responds to the attack, defends the original verdict
  Round 3 - JUDGE: weighs both arguments, issues final ruling

All 3 rounds use DeepSeek (cheap). Total cost: ~$0.003 per finding.

This creates a visible, auditable debate transcript that:
  1. Strengthens correct verdicts (they survive scrutiny)
  2. Catches errors (weak verdicts get revised)
  3. Demonstrates reasoning transparency to competition judges
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from argus.agents.confidence_calculator import compute_confidence_breakdown
from argus.llm.cheap_client import CheapLLMClient
from argus.log import log
from argus.models.domain import (
    Evidence,
    Finding,
    FindingVerdict,
    ReasoningStep,
)

# --- Prompts for each debate role ---

ATTACKER_PROMPT = """\
You are the ATTACKER in a fact-checking debate. Your job is to find weaknesses
in an initial verdict. Be aggressive but fair — only raise points with substance.

Think about:
1. Could the evidence be misinterpreted or taken out of context?
2. Are there alternative explanations the verifier missed?
3. Could the claim be correct in a different timeframe or context?
4. Are the sources reliable enough for this specific claim?
5. Is the logical reasoning from evidence to verdict sound?

Output JSON:
{
  "attack_points": ["point 1", "point 2", ...],
  "strongest_attack": "your single strongest argument against the verdict",
  "attack_strength": float 0-1 (how confident you are the verdict is wrong),
  "evidence_specificity": float 0-1 (how precisely does the evidence address the claim?)
}
"""

DEFENDER_PROMPT = """\
You are the DEFENDER in a fact-checking debate. The Attacker has raised
objections to a verdict. Your job is to defend the original verdict by
addressing each attack point.

For each attack point, either:
- REBUT: explain why the attack is invalid
- CONCEDE: acknowledge the point has merit

Output JSON:
{
  "rebuttals": [
    {"attack_point": "...", "response": "rebut|concede", "argument": "..."}
  ],
  "defense_holds": boolean (true if verdict should stand, false if attacker won),
  "defense_confidence": float 0-1
}
"""

JUDGE_PROMPT = """\
You are the JUDGE in a fact-checking debate. You have seen:
- The original verdict and evidence
- The Attacker's challenges
- The Defender's rebuttals

Make your ruling:
1. Did the attack succeed? (Were there valid points that weren't rebutted?)
2. Should the verdict be revised?
3. What is the final confidence level?

Output JSON:
{
  "ruling": "verdict_stands" | "verdict_revised",
  "revised_verdict": null | "ok" | "fabricated" | "partial-match"
                    | "mismatch" | "stale" | "superseded" | "uncertain",
  "final_confidence": float 0-1,
  "ruling_reasoning": "2-3 sentences explaining the ruling",
  "key_factors": ["factor 1", "factor 2"]
}
"""

# Only debate these verdicts (skip trivial "ok" findings)
_DEBATABLE_VERDICTS = {
    FindingVerdict.FABRICATED,
    FindingVerdict.MISMATCH,
    FindingVerdict.MISREPRESENTED,
    FindingVerdict.STALE,
    FindingVerdict.SUPERSEDED,
    FindingVerdict.CONTRADICTION,
    FindingVerdict.PARTIAL_MATCH,
}


# --- Output models ---

class AttackerOutput(BaseModel):
    attack_points: list[str] = Field(default_factory=list)
    strongest_attack: str = ""
    attack_strength: float = Field(default=0.3, ge=0.0, le=1.0)
    evidence_specificity: float = Field(default=0.5, ge=0.0, le=1.0)


class RebuttalItem(BaseModel):
    attack_point: str = ""
    response: str = "rebut"  # "rebut" or "concede"
    argument: str = ""


class DefenderOutput(BaseModel):
    rebuttals: list[RebuttalItem] = Field(default_factory=list)
    defense_holds: bool = True
    defense_confidence: float = Field(default=0.7, ge=0.0, le=1.0)


class JudgeOutput(BaseModel):
    ruling: str = "verdict_stands"  # "verdict_stands" or "verdict_revised"
    revised_verdict: FindingVerdict | None = None
    final_confidence: float = Field(default=0.8, ge=0.0, le=1.0)
    ruling_reasoning: str = ""
    key_factors: list[str] = Field(default_factory=list)


# --- Main debate function ---

async def challenge_findings(
    client: CheapLLMClient,
    findings: list[Finding],
    claims_map: dict[str, str],
    evidences_map: dict[str, list[Evidence]] | None = None,
) -> list[Finding]:
    """Run 3-round adversarial debate on each non-trivial finding.

    Args:
        client: DeepSeek client
        findings: findings to debate
        claims_map: claim_id -> claim text
        evidences_map: finding_id -> list of Evidence objects (for algorithmic confidence)
    """
    if evidences_map is None:
        evidences_map = {}

    challenged: list[Finding] = []
    for finding in findings:
        if finding.verdict not in _DEBATABLE_VERDICTS:
            # "ok" findings get algorithmic confidence only, no debate
            evs = evidences_map.get(finding.id, [])
            finding.confidence_breakdown = compute_confidence_breakdown(
                finding, evs, llm_specificity=0.8
            )
            finding.reasoning_chain = [
                ReasoningStep(
                    step="verification",
                    content=f"Claim confirmed: {finding.summary}",
                    confidence_delta=0.0,
                )
            ]
            challenged.append(finding)
            continue

        claim_text = claims_map.get(finding.claim_id, "(unknown)")
        try:
            await _run_debate(client, finding, claim_text, evidences_map)
        except Exception as exc:
            log.warning("challenger.debate_failed", finding_id=finding.id,
                        error=str(exc)[:200])
            finding.challenge_result = "debate_skipped: processing error"

        challenged.append(finding)

    return challenged


async def _run_debate(
    client: CheapLLMClient,
    finding: Finding,
    claim_text: str,
    evidences_map: dict[str, list[Evidence]],
) -> None:
    """Execute 3-round debate on a single finding."""

    context = (
        f"CLAIM: {claim_text}\n"
        f"VERDICT: {finding.verdict.value}\n"
        f"CONFIDENCE: {finding.confidence}\n"
        f"SUMMARY: {finding.summary}"
    )

    # --- Round 1: Attacker ---
    attacker_input = f"{context}\n\nAttack this verdict. Find weaknesses."
    attack = await client.complete(
        system_prompt=ATTACKER_PROMPT,
        user_input=attacker_input,
        model_cls=AttackerOutput,
    )

    # --- Round 2: Defender ---
    defender_input = (
        f"{context}\n\n"
        f"ATTACKER'S POINTS:\n"
        + "\n".join(f"- {p}" for p in attack.attack_points)
        + f"\n\nSTRONGEST ATTACK: {attack.strongest_attack}\n\n"
        "Defend the original verdict against these attacks."
    )
    defense = await client.complete(
        system_prompt=DEFENDER_PROMPT,
        user_input=defender_input,
        model_cls=DefenderOutput,
    )

    # --- Round 3: Judge ---
    conceded = [r for r in defense.rebuttals if r.response == "concede"]
    rebutted = [r for r in defense.rebuttals if r.response == "rebut"]

    judge_input = (
        f"{context}\n\n"
        f"ATTACK (strength={attack.attack_strength:.2f}):\n"
        f"  Points: {attack.attack_points}\n"
        f"  Strongest: {attack.strongest_attack}\n\n"
        f"DEFENSE (holds={defense.defense_holds}):\n"
        f"  Rebutted {len(rebutted)} points, conceded {len(conceded)} points\n"
        f"  Defense confidence: {defense.defense_confidence:.2f}\n\n"
        "Issue your ruling."
    )
    ruling = await client.complete(
        system_prompt=JUDGE_PROMPT,
        user_input=judge_input,
        model_cls=JudgeOutput,
    )

    # --- Apply results ---
    _apply_debate_results(finding, attack, defense, ruling, evidences_map)


def _apply_debate_results(
    finding: Finding,
    attack: AttackerOutput,
    defense: DefenderOutput,
    ruling: JudgeOutput,
    evidences_map: dict[str, list[Evidence]],
) -> None:
    """Apply the 3-round debate results to the finding."""

    # Build debate transcript as challenge_result
    conceded_points = [r for r in defense.rebuttals if r.response == "concede"]
    transcript_parts = [
        f"DEBATE RESULT: {ruling.ruling.upper()}",
        f"  Attack strength: {attack.attack_strength:.2f}",
        f"  Strongest attack: {attack.strongest_attack}",
        f"  Defense holds: {defense.defense_holds}",
        f"  Conceded points: {len(conceded_points)}",
        f"  Judge ruling: {ruling.ruling_reasoning}",
    ]
    finding.challenge_result = "\n".join(transcript_parts)

    # Apply verdict revision if judge says so
    if ruling.ruling == "verdict_revised" and ruling.revised_verdict is not None:
        finding.verdict = ruling.revised_verdict

    finding.confidence = ruling.final_confidence

    # Build structured reasoning chain from the debate
    chain: list[ReasoningStep] = [
        ReasoningStep(
            step="premise",
            content=f"Initial verdict: {finding.verdict.value} (conf={finding.confidence:.2f})",
            confidence_delta=0.0,
        ),
        ReasoningStep(
            step="challenge",
            content=f"Attacker (str={attack.attack_strength:.2f}): {attack.strongest_attack}",
            confidence_delta=-attack.attack_strength * 0.3,
        ),
    ]

    # Add defense rebuttals
    for r in defense.rebuttals[:3]:  # Cap at 3 for readability
        delta = 0.05 if r.response == "rebut" else -0.1
        chain.append(ReasoningStep(
            step="defense" if r.response == "rebut" else "concession",
            content=f"{r.response.upper()}: {r.argument[:100]}",
            confidence_delta=delta,
        ))

    # Final resolution
    chain.append(ReasoningStep(
        step="resolution",
        content=f"Judge: {ruling.ruling_reasoning[:120]}",
        confidence_delta=ruling.final_confidence - finding.confidence,
    ))
    finding.reasoning_chain = chain

    # Compute algorithmic confidence breakdown
    evs = evidences_map.get(finding.id, [])
    finding.confidence_breakdown = compute_confidence_breakdown(
        finding, evs, llm_specificity=attack.evidence_specificity
    )
