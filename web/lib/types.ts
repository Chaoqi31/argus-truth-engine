// Domain types are generated from the backend models (scripts/gen_web_types.py);
// the rest are the web's own.
import type { Claim, Job } from "./generated/argus";

export type {
  Agent,
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
  Engine,
  EventFrame,
  Evidence,
  EvidenceQuality,
  EvidenceSource,
  Failure,
  FailureKind,
  Finding,
  FindingVerdict,
  Frame,
  Job,
  ReasoningTrace,
  Severity,
  SkepticCounterevidence,
  SkepticReview,
  SnapshotFrame,
  Stage,
  StageFilteredClaim,
  StageKey,
  StageStatus,
  Step,
  StepType,
  Usage,
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

/** Where the run is: the socket's state before a snapshot, then the job's own. */
export type RunStatus =
  | "idle"
  | "connecting"
  | "running"
  | "reviewing"
  | "verifying"
  | "done"
  | "failed";
