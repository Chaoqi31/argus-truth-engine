// Domain types are generated from the backend models (scripts/gen_web_types.py);
// the rest are the web's own.
import type { Claim, ClaimType, FindingVerdict, Job, Severity } from "./generated/argus";

export type {
  BenchmarkExpectedClaim,
  BenchmarkSpec,
  Claim,
  ClaimCoverage,
  ClaimType,
  ComputationCheck,
  ComputationValue,
  ConfidenceBreakdown,
  ContentDomain,
  CorrectedInfo,
  Evidence,
  EvidenceQuality,
  EvidenceSource,
  Failure,
  FailureKind,
  Finding,
  FindingVerdict,
  Job,
  ReasoningTrace,
  Severity,
  SkepticCounterevidence,
  SkepticReview,
  Stage,
  StageFilteredClaim,
  Step,
  StepType,
  VerificationStep,
} from "./generated/argus";

export type JobStatus = Job["status"];

export type ReviewerStatus = "open" | "accepted" | "disputed" | "needs-recheck" | "resolved";

export interface FindingReview {
  status: ReviewerStatus;
  note: string;
  updated_at: string;
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

export interface LiveHeartbeat {
  stage: string;
  agent: string;
  claim_id?: string | null;
  elapsed_s: number;
  message: string;
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
