import type { Job } from "@/lib/types";

export type ExecutionControlId =
  | "background_responses"
  | "resumable_cursors"
  | "parallel_fanout"
  | "review_checkpoint"
  | "budget_guard"
  | "skeptic_fanin";

export type ExecutionControlStatus = "present" | "missing" | "not_applicable";

export interface ExecutionControl {
  id: ExecutionControlId;
  label: string;
  status: ExecutionControlStatus;
  detail: string;
}

export interface ExecutionControlSummary {
  presentCount: number;
  requiredCount: number;
  controls: ExecutionControl[];
}

const CONTROL_LABEL: Record<ExecutionControlId, string> = {
  background_responses: "Background responses",
  resumable_cursors: "Resumable stream cursors",
  parallel_fanout: "Parallel verifier fan-out",
  review_checkpoint: "Review checkpoint",
  budget_guard: "Budget guard",
  skeptic_fanin: "Skeptic fan-in",
};

function control(
  id: ExecutionControlId,
  status: ExecutionControlStatus,
  detail: string,
): ExecutionControl {
  return { id, label: CONTROL_LABEL[id], status, detail };
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function isMiroMindResponseId(id: string): boolean {
  return Boolean(id) && id !== "n/a" && !id.startsWith("deepseek:");
}

export function getJobExecutionControls(job: Job): ExecutionControlSummary {
  const verifierTraces = job.traces.filter((trace) => trace.agent === "UnifiedVerifier");
  const miromindTraces = job.traces.filter((trace) =>
    isMiroMindResponseId(trace.miromind_response_id),
  );
  const responseIds = new Set(miromindTraces.map((trace) => trace.miromind_response_id));
  const cursorSteps = miromindTraces.reduce(
    (sum, trace) => sum + trace.steps.filter((step) => Number.isFinite(step.sequence)).length,
    0,
  );
  const audited = job.claims_audited ?? verifierTraces.length;
  const total = job.claims_total ?? job.claims.length;
  const hasStage = (key: string) => (job.stages ?? []).some((stage) => stage.key === key);
  const issueNeedsChallenge = job.findings.some(
    (finding) =>
      finding.agent === "UnifiedVerifier" &&
      finding.verdict !== "ok" &&
      (finding.severity === "major" || finding.severity === "critical"),
  );
  const challengedFindings = job.findings.filter((finding) => finding.skeptic_review).length;
  const needsFanout = total > 1 || audited > 1 || verifierTraces.length > 1;

  const controls: ExecutionControl[] = [
    control(
      "background_responses",
      responseIds.size > 0 ? "present" : "missing",
      responseIds.size > 0
        ? `${plural(responseIds.size, "response id")} saved from MiroMind background runs`
        : "No MiroMind response ids were recorded.",
    ),
    control(
      "resumable_cursors",
      responseIds.size > 0 && cursorSteps > 0 ? "present" : "missing",
      cursorSteps > 0
        ? `${plural(cursorSteps, "cursor-indexed step")} persisted for stream replay`
        : "No sequence-numbered stream steps were recorded.",
    ),
    control(
      "parallel_fanout",
      !needsFanout
        ? "not_applicable"
        : verifierTraces.length > 1
          ? "present"
          : "missing",
      !needsFanout
        ? "Single-claim audit; no verifier fan-out needed."
        : `${plural(verifierTraces.length, "verifier trace")} for ${audited}/${total} audited claims`,
    ),
    control(
      "review_checkpoint",
      hasStage("review_gate") ? "present" : "missing",
      hasStage("review_gate")
        ? "Review gate stage recorded before paid verification."
        : "No review checkpoint stage was recorded.",
    ),
    control(
      "budget_guard",
      total > 0 ? "present" : "missing",
      total > 0
        ? `${formatUsd(job.cost_usd)} spent · ${audited}/${total} audited`
        : "No coverage counters were recorded for budget enforcement.",
    ),
    control(
      "skeptic_fanin",
      !issueNeedsChallenge
        ? "not_applicable"
        : hasStage("skeptic") && challengedFindings > 0
          ? "present"
          : "missing",
      !issueNeedsChallenge
        ? "No major/critical non-OK verifier findings required challenge."
        : `${plural(challengedFindings, "finding")} independently challenged before confidence scoring`,
    ),
  ];

  const required = controls.filter((item) => item.status !== "not_applicable");
  return {
    presentCount: required.filter((item) => item.status === "present").length,
    requiredCount: required.length,
    controls,
  };
}
