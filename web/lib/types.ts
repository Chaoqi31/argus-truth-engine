// Hand-mirrored from src/argus/models/domain.py. Update both when one changes.

export type ClaimType =
  | "citation"
  | "numerical-data"
  | "time-sensitive"
  | "cross-reference"
  | "qualitative";

export type Severity = "critical" | "major" | "minor";

export type FindingVerdict =
  | "ok"
  | "fabricated"
  | "partial-match"
  | "mismatch"
  | "misrepresented"
  | "stale"
  | "superseded"
  | "contradiction"
  | "inaccurate"
  | "outdated"
  | "uncertain"
  | "unsupported-inference"
  | "overreach";

export type EvidenceSourceType =
  | "crossref"
  | "arxiv"
  | "ssrn"
  | "sec_edgar"
  | "fred"
  | "worldbank"
  | "imf"
  | "wikipedia"
  | "company_filing"
  | "web_page"
  | "internal_doc";

export type StepType =
  | "thinking"
  | "web_search"
  | "fetch_url_content"
  | "execute_python"
  | "execute_command"
  | "tool_call"
  | "message";

export interface Claim {
  id: string;
  text: string;
  page: number;
  span: [number, number];
  type: ClaimType;
  importance: "high" | "medium" | "low";
  extracted_metadata: Record<string, unknown>;
  parent_claim_id?: string | null;
}

export interface Evidence {
  id: string;
  source_type: EvidenceSourceType;
  url: string | null;
  citation: string;
  snippet: string;
  full_content_ref: string | null;
  retrieved_at: string; // ISO datetime
  retrieved_by_step_id: string;
}

export interface Step {
  id: string;
  trace_id: string;
  sequence: number;
  type: StepType;
  summary: string;
  content: Record<string, unknown>;
  evidence_ids: string[];
  parent_step_id: string | null;
  created_at: string;
}

export interface ReasoningTrace {
  id: string;
  job_id: string;
  claim_id: string;
  agent: string;
  miromind_response_id: string;
  started_at: string;
  completed_at: string | null;
  total_tokens: number;
  reasoning_tokens: number;
  num_search_queries: number;
  final_verdict_step_id: string | null;
  steps: Step[];
}

export interface ConfidenceBreakdownData {
  source_agreement: number;
  source_authority: number;
  evidence_freshness: number;
  reasoning: string;
}

/** The corrected fact for an inaccurate/outdated/misrepresented claim. */
export interface CorrectedInfo {
  value: string;
  source: string;
  url?: string | null;
  retrieved_date?: string | null;
}

export interface ReasoningStep {
  step: string;
  content: string;
  evidence_ref?: string | null;
  confidence_delta?: number;
}

export interface VerificationStep {
  action: string;
  observation: string;
  reasoning: string;
}

export type FindingReasoningStep = ReasoningStep | VerificationStep;

export interface EvidenceQuality {
  evidence_id: string;
  authority: number;
  independence: number;
  freshness: number;
  directness: number;
  role: string;
  rationale: string;
}

export interface ClaimCoverage {
  claim_fragment: string;
  relation: string;
  evidence_ids: string[];
  reason: string;
}

export interface ComputationValue {
  label: string;
  value: string;
  unit: string;
  source_evidence_id?: string | null;
}

export interface ComputationCheck {
  kind: "numeric" | "date";
  claimed_value: string;
  extracted_values: ComputationValue[];
  formula: string;
  computed_value: string;
  tolerance: string;
  judgment: string;
  rationale: string;
}

export interface SkepticCounterevidence {
  source: string;
  url?: string | null;
  snippet: string;
  relevance: string;
}

export interface SkepticReview {
  status: "no_counterevidence" | "counterevidence_found" | "inconclusive";
  summary: string;
  recommended_verdict?: FindingVerdict | null;
  counterevidence: SkepticCounterevidence[];
}

export type ReviewerStatus = "open" | "accepted" | "disputed" | "needs-recheck" | "resolved";

export interface FindingReview {
  status: ReviewerStatus;
  note: string;
  updated_at: string;
}

export interface Finding {
  id: string;
  job_id: string;
  claim_id: string;
  agent: string;
  verdict: FindingVerdict;
  severity: Severity;
  confidence: number;
  confidence_breakdown?: ConfidenceBreakdownData | null;
  summary: string;
  /** Plain-language explanation of *why* the claim is wrong (non-OK verdicts). */
  why_wrong?: string | null;
  /** What the right answer is, with an authoritative source. */
  correct_information?: CorrectedInfo | null;
  /** Structured explanation returned by the verifier before the raw trace. */
  reasoning_chain?: FindingReasoningStep[];
  evidence_quality?: EvidenceQuality[];
  coverage?: ClaimCoverage[];
  skeptic_review?: SkepticReview | null;
  computation_check?: ComputationCheck | null;
  evidence_ids: string[];
  reasoning_trace_id: string;
  related_finding_ids: string[];
  created_at: string;
  /** User-facing caveats (e.g. "single source — verify manually"). */
  flags?: string[];
}

export type JobStatus =
  | "queued"
  | "parsing"
  | "planning"
  | "atomizing"
  | "filtering"
  | "reviewing"
  | "verifying"
  | "reporting"
  | "done"
  | "failed"
  | "interrupted";

/** A claim dropped by the check-worthiness stage, with the reason. */
export interface StageFilteredClaim {
  claim_id?: string | null;
  text: string;
  reason: string;
}

/** One pipeline stage's persisted summary (UI: the clickable stage rows). */
export interface Stage {
  key: string;
  name: string;
  engine: "deepseek" | "miromind" | "deterministic";
  summary: string;
  metrics: Record<string, number>;
  strategy?: string | null;
  filtered_claims?: StageFilteredClaim[] | null;
}

export interface BenchmarkExpectedClaim {
  claim_id: string;
  verdict: FindingVerdict;
  rationale: string;
}

export interface BenchmarkSpec {
  name: string;
  expected_claims: BenchmarkExpectedClaim[];
}

export interface Job {
  id: string;
  scenario_label?: string | null;
  persona?: string | null;
  pdf_path: string;
  input_text?: string | null;
  input_mode?: "pdf" | "text";
  content_domain?:
    | "general"
    | "academic"
    | "medical"
    | "legal"
    | "finance"
    | "technology"
    | "news"
    | "science";
  status: JobStatus;
  created_at: string;
  completed_at: string | null;
  cost_usd: number;
  total_tokens: number;
  /** Claims sent to Phase B verification, and how many received a verdict. */
  claims_total?: number;
  claims_audited?: number;
  audit_report_md: string | null;
  claims: Claim[];
  findings: Finding[];
  traces: ReasoningTrace[];
  evidences: Evidence[];
  stages?: Stage[];
  benchmark?: BenchmarkSpec | null;
}

export function isCitationClaim(c: Claim): boolean {
  return c.type === "citation";
}

// --- Live-mode (B3-C) -------------------------------------------------------

export type RunStatus = "idle" | "connecting" | "running" | "reviewing" | "verifying" | "done" | "failed";

/**
 * Preview shape for findings streamed over the WebSocket before the final
 * `GET /jobs/{id}` lands. Mirrors only the fields published in the WS
 * `finding` payload — no evidence_ids, no reasoning_trace_id.
 */
export interface LiveFinding {
  id: string;
  claim_id: string;
  agent: string;
  verdict: FindingVerdict;
  severity: Severity;
  summary: string;
}

/** Claim data sent in the review_ready trace event. */
export interface ReviewClaim {
  id: string;
  text: string;
  type: ClaimType;
  importance: "high" | "medium" | "low";
  parent_claim_id?: string | null;
}

export interface FilteredClaim {
  claim_id: string;
  text: string;
  reason: string;
}
