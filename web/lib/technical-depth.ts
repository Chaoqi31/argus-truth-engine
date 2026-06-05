import { getJobAuditability } from "@/lib/auditability";
import { getAuditFingerprint } from "@/lib/audit-fingerprint";
import { getBenchmarkEvaluation } from "@/lib/benchmark-evaluation";
import { getJobExecutionControls } from "@/lib/execution-controls";
import { formatNumber, isMiroMindResponseId, pct, plural } from "@/lib/format";
import type { Job } from "@/lib/types";

export type TechnicalProofId =
  | "agent_pipeline"
  | "miromind_deep_research"
  | "parallel_fanout"
  | "resumable_stream"
  | "review_checkpoint"
  | "budget_guard"
  | "skeptic_challenge"
  | "auditability"
  | "audit_fingerprint"
  | "benchmark_eval";

export type TechnicalProofStatus = "present" | "missing" | "not_applicable";

export interface TechnicalProof {
  id: TechnicalProofId;
  label: string;
  status: TechnicalProofStatus;
  evidence: string;
}

export interface TechnicalDepthProof {
  presentCount: number;
  requiredCount: number;
  proofs: TechnicalProof[];
}

export type JudgeProofId =
  | "architecture"
  | "miromind_trace"
  | "benchmark"
  | "skeptic"
  | "fingerprint";

export interface JudgeProof {
  id: JudgeProofId;
  label: string;
  status: TechnicalProofStatus;
  detail: string;
}

const LABELS: Record<TechnicalProofId, string> = {
  agent_pipeline: "LangGraph multi-stage graph",
  miromind_deep_research: "MiroMind deep research",
  parallel_fanout: "Parallel verifier fan-out",
  resumable_stream: "Resumable stream replay",
  review_checkpoint: "Human review checkpoint",
  budget_guard: "Budget guard",
  skeptic_challenge: "Independent skeptic challenge",
  auditability: "Finding-level auditability controls",
  audit_fingerprint: "Stable audit fingerprint",
  benchmark_eval: "Ground-truth benchmark eval",
};

function proof(
  id: TechnicalProofId,
  status: TechnicalProofStatus,
  evidence: string,
): TechnicalProof {
  return { id, label: LABELS[id], status, evidence };
}

function executionDetail(
  job: Job,
  id: "parallel_fanout" | "resumable_cursors" | "review_checkpoint" | "budget_guard" | "skeptic_fanin",
) {
  return getJobExecutionControls(job).controls.find((control) => control.id === id);
}

function judgeProof(
  id: JudgeProofId,
  label: string,
  status: TechnicalProofStatus,
  detail: string,
): JudgeProof {
  return { id, label, status, detail };
}

export function getJudgeProofStrip(job: Job): JudgeProof[] {
  const stages = job.stages ?? [];
  const technical = getTechnicalDepthProof(job);
  const proofById = new Map(technical.proofs.map((item) => [item.id, item]));
  const benchmark = getBenchmarkEvaluation(job);
  const fingerprint = getAuditFingerprint(job);
  const skeptic = executionDetail(job, "skeptic_fanin");
  const challengedFindings = job.findings.filter((finding) => finding.skeptic_review).length;
  const architecturePresent =
    proofById.get("agent_pipeline")?.status === "present" &&
    proofById.get("parallel_fanout")?.status === "present" &&
    stages.some((stage) => stage.key === "review_gate");
  const nativeTrace = proofById.get("miromind_deep_research");
  const skepticStatus = (skeptic?.status ?? "missing") as TechnicalProofStatus;

  return [
    judgeProof(
      "architecture",
      "Architecture",
      architecturePresent ? "present" : "missing",
      architecturePresent
        ? `${stages.length}-stage graph with review gate + verifier fan-out`
        : "Missing persisted multi-stage graph, review gate, or verifier fan-out.",
    ),
    judgeProof(
      "miromind_trace",
      "Native trace",
      nativeTrace?.status ?? "missing",
      nativeTrace?.evidence ?? "No saved MiroMind response ids or tool trace.",
    ),
    judgeProof(
      "benchmark",
      "Benchmark",
      benchmark ? "present" : "not_applicable",
      benchmark
        ? `${benchmark.exactMatches}/${benchmark.total} exact matches · ${pct(benchmark.issueRecall)} issue recall · ${benchmark.falsePositives} false positives`
        : "No planted benchmark labels supplied for this live job.",
    ),
    judgeProof(
      "skeptic",
      "Skeptic",
      skepticStatus,
      skepticStatus === "present"
        ? `${challengedFindings} challenged before confidence scoring`
        : (skeptic?.detail ?? "No independent challenge pass evidence."),
    ),
    judgeProof(
      "fingerprint",
      "Fingerprint",
      "present",
      `${fingerprint.fingerprint} · ${plural(fingerprint.included.steps, "step")} replayable`,
    ),
  ];
}

export function getTechnicalDepthProof(job: Job): TechnicalDepthProof {
  const stages = job.stages ?? [];
  const miromindTraces = job.traces.filter((trace) =>
    isMiroMindResponseId(trace.miromind_response_id),
  );
  const responseIds = new Set(miromindTraces.map((trace) => trace.miromind_response_id));
  const searches = miromindTraces.reduce((sum, trace) => {
    const stepSearches = trace.steps.filter((step) => step.type === "web_search").length;
    return sum + (trace.num_search_queries > 0 ? trace.num_search_queries : stepSearches);
  }, 0);
  const reasoningTokens = miromindTraces.reduce((sum, trace) => sum + trace.reasoning_tokens, 0);
  const totalTokens = miromindTraces.reduce((sum, trace) => sum + trace.total_tokens, 0);
  const tokenEvidence =
    reasoningTokens > 0
      ? `${formatNumber(reasoningTokens)} reasoning tokens`
      : `${formatNumber(totalTokens)} total tokens`;
  const stageNames = stages.map((stage) => stage.name).join(" -> ");
  const hasMultiStageGraph =
    stages.length >= 4 &&
    stages.some((stage) => stage.engine === "miromind") &&
    stages.some((stage) => stage.engine === "deepseek" || stage.engine === "deterministic");
  const auditability = getJobAuditability(job);
  const fingerprint = getAuditFingerprint(job);
  const benchmark = getBenchmarkEvaluation(job);
  const auditabilityHasStructuredControls = auditability.controls.some(
    (control) =>
      (control.id === "provenance" || control.id === "coverage" || control.id === "source_quality") &&
      control.present > 0,
  );
  const parallel = executionDetail(job, "parallel_fanout");
  const resumable = executionDetail(job, "resumable_cursors");
  const review = executionDetail(job, "review_checkpoint");
  const budget = executionDetail(job, "budget_guard");
  const skeptic = executionDetail(job, "skeptic_fanin");

  const proofs: TechnicalProof[] = [
    proof(
      "agent_pipeline",
      hasMultiStageGraph ? "present" : "missing",
      hasMultiStageGraph
        ? `${plural(stages.length, "persisted stage")}: ${stageNames}`
        : `${plural(stages.length, "persisted stage")} recorded; expected multi-stage graph evidence.`,
    ),
    proof(
      "miromind_deep_research",
      responseIds.size > 0 && searches > 0 ? "present" : "missing",
      responseIds.size > 0
        ? `${plural(responseIds.size, "response id")} · ${plural(searches, "search", "searches")} · ${tokenEvidence}`
        : "No saved MiroMind background response ids.",
    ),
    proof(
      "parallel_fanout",
      (parallel?.status ?? "missing") as TechnicalProofStatus,
      parallel?.detail ?? "No verifier fan-out evidence.",
    ),
    proof(
      "resumable_stream",
      (resumable?.status ?? "missing") as TechnicalProofStatus,
      resumable?.detail ?? "No cursor-indexed trace replay evidence.",
    ),
    proof(
      "review_checkpoint",
      (review?.status ?? "missing") as TechnicalProofStatus,
      review?.detail ?? "No review checkpoint evidence.",
    ),
    proof(
      "budget_guard",
      (budget?.status ?? "missing") as TechnicalProofStatus,
      budget?.detail ?? "No budget guard evidence.",
    ),
    proof(
      "skeptic_challenge",
      (skeptic?.status ?? "missing") as TechnicalProofStatus,
      skeptic?.detail ?? "No independent challenge evidence.",
    ),
    proof(
      "auditability",
      auditabilityHasStructuredControls ? "present" : "missing",
      auditability.requiredCount > 0
        ? `${auditability.fullyAuditableFindings}/${auditability.findings} fully audit-ready findings · ${auditability.presentCount}/${auditability.requiredCount} controls present · ${plural(auditability.incompleteFindings, "finding")} in gap register`
        : "No verifier findings to assess for auditability controls.",
    ),
    proof(
      "audit_fingerprint",
      "present",
      `${fingerprint.fingerprint} over ${plural(fingerprint.included.claims, "claim")}, ${plural(fingerprint.included.findings, "finding")}, ${plural(fingerprint.included.traces, "trace")}, ${plural(fingerprint.included.steps, "step")}, ${plural(fingerprint.included.evidences, "evidence source")}, ${plural(fingerprint.included.stages, "stage")}`,
    ),
    proof(
      "benchmark_eval",
      benchmark ? "present" : "not_applicable",
      benchmark
        ? `${benchmark.exactMatches}/${benchmark.total} exact verifier matches · ${pct(benchmark.issueRecall)} issue recall · ${benchmark.falsePositives} false positives`
        : "No fixture ground truth supplied for this live job.",
    ),
  ];

  const required = proofs.filter((item) => item.status !== "not_applicable");
  return {
    presentCount: required.filter((item) => item.status === "present").length,
    requiredCount: required.length,
    proofs,
  };
}
