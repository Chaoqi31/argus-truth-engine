// Stage vocabulary. The backend names a stage with its key; everything the
// reader sees is written here.
import type { StageKey } from "./generated/argus";

export const STAGE_LABEL: Record<StageKey, string> = {
  parse: "Parse",
  planner: "Planner",
  atomizer: "Atomizer",
  checkworthiness: "Check-worthiness",
  shortlist: "Shortlist",
  review: "Review gate",
  verify: "Verification",
  skeptic: "Skeptic",
  consistency: "Consistency",
  confidence: "Confidence",
  reporter: "Reporter",
};

/** What each stage does, in one line. */
export const STAGE_BLURB: Record<StageKey, string> = {
  parse: "Extracts the raw text and character offsets from the document.",
  planner: "Reads the document and pulls out the discrete factual claims worth checking.",
  atomizer: "Splits compound claims into atomic, independently-verifiable statements.",
  checkworthiness:
    "Drops opinions, forecasts and trivia — keeps only checkable factual claims.",
  shortlist: "De-duplicates the claims and caps how many go to paid verification.",
  review: "Sends the shortlisted claims to the reviewer, who chooses what to verify.",
  verify:
    "Runs each claim through MiroMind deep research — web searches, fetches, reasoning.",
  skeptic:
    "Independently challenges high-risk MiroMind verdicts by searching for counterevidence before confidence scoring.",
  consistency: "Checks the claims against each other for contradictions and unsupported leaps.",
  confidence: "Scores each verdict on source authority, evidence freshness and source agreement.",
  reporter: "Writes the executive summary of the audit.",
};

/** Human-readable labels for the per-stage metric chips. */
export const METRIC_LABEL: Record<string, string> = {
  pages: "pages",
  chars: "chars",
  n_claims: "claims",
  n_original: "original",
  n_atoms: "atomic",
  n_checkworthy: "check-worthy",
  n_filtered: "filtered",
  n_before: "before",
  n_after: "after",
  n_shortlisted: "shortlisted",
  n_candidates: "candidates",
  n_selected: "selected",
  n_verifying: "to verify",
  n_steps: "steps",
  n_searches: "web searches",
  n_findings: "findings",
  n_scored: "scored",
  n_reviewed: "reviewed",
  n_cleared: "cleared",
  n_counterevidence_found: "counterevidence",
  n_inconclusive: "inconclusive",
};

export function stageLabel(key: StageKey): string {
  return STAGE_LABEL[key] ?? key;
}
