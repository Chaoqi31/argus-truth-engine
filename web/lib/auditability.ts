import type { Finding, Job } from "@/lib/types";
import { plural } from "@/lib/format";
import { isDerivedFinding } from "@/lib/findings";

export type AuditabilityControlId =
  | "trace"
  | "evidence"
  | "provenance"
  | "coverage"
  | "source_quality"
  | "skeptic"
  | "computation";

export type AuditabilityStatus = "present" | "missing" | "not_applicable";

export interface AuditabilityControl {
  id: AuditabilityControlId;
  label: string;
  status: AuditabilityStatus;
  detail: string;
}

export interface FindingAuditability {
  findingId: string;
  presentCount: number;
  requiredCount: number;
  controls: AuditabilityControl[];
}

export interface JobAuditabilityControl {
  id: AuditabilityControlId;
  label: string;
  present: number;
  required: number;
  missing: number;
}

export interface JobAuditabilityGap {
  findingId: string;
  claimId: string;
  claimText: string;
  verdict: Finding["verdict"];
  severity: Finding["severity"];
  missingControlIds: AuditabilityControlId[];
  missingControlLabels: string[];
}

export interface JobAuditability {
  findings: number;
  presentCount: number;
  requiredCount: number;
  fullyAuditableFindings: number;
  incompleteFindings: number;
  controls: JobAuditabilityControl[];
  gapRows: JobAuditabilityGap[];
}

const CONTROL_LABEL: Record<AuditabilityControlId, string> = {
  trace: "Reasoning trace",
  evidence: "Linked evidence",
  provenance: "Evidence-to-step provenance",
  coverage: "Claim coverage matrix",
  source_quality: "Source-quality scoring",
  skeptic: "Independent challenge",
  computation: "Computation replay",
};

const CONTROL_ORDER: AuditabilityControlId[] = [
  "trace",
  "evidence",
  "provenance",
  "coverage",
  "source_quality",
  "skeptic",
  "computation",
];

function control(
  id: AuditabilityControlId,
  status: AuditabilityStatus,
  detail: string,
): AuditabilityControl {
  return { id, label: CONTROL_LABEL[id], status, detail };
}

export function getFindingAuditability(
  job: Job,
  finding: Finding,
): FindingAuditability {
  const claim = job.claims.find((c) => c.id === finding.claim_id);
  const trace = job.traces.find((t) => t.id === finding.reasoning_trace_id);
  const traceStepIds = new Set(trace?.steps.map((step) => step.id) ?? []);
  const evidenceById = new Map(job.evidences.map((e) => [e.id, e]));
  const evidenceIds = finding.evidence_ids;
  const derived = isDerivedFinding(finding);
  const derivedDetail = `${finding.agent} finding derived from pipeline outputs; it does not create new external-source evidence.`;
  const linkedEvidence = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((e) => e !== undefined);
  const provenanceLinked = linkedEvidence.filter((e) =>
    traceStepIds.has(e.retrieved_by_step_id),
  ).length;
  const issueNeedsChallenge =
    finding.agent === "UnifiedVerifier" &&
    finding.verdict !== "ok" &&
    (finding.severity === "major" || finding.severity === "critical");
  const needsComputation =
    claim?.type === "numerical-data" || finding.computation_check != null;

  const controls: AuditabilityControl[] = [
    control(
      "trace",
      trace && trace.steps.length > 0 && trace.miromind_response_id ? "present" : "missing",
      trace && trace.steps.length > 0
        ? `${plural(trace.steps.length, "step")} · response ${trace.miromind_response_id || "missing"}`
        : "No saved reasoning trace.",
    ),
    control(
      "evidence",
      derived && evidenceIds.length === 0
        ? "not_applicable"
        : evidenceIds.length > 0 && linkedEvidence.length === evidenceIds.length
          ? "present"
          : "missing",
      derived && evidenceIds.length === 0
        ? derivedDetail
        : evidenceIds.length > 0
        ? `${linkedEvidence.length}/${evidenceIds.length} sources resolved`
        : "No evidence IDs attached.",
    ),
    control(
      "provenance",
      derived && evidenceIds.length === 0
        ? "not_applicable"
        : linkedEvidence.length > 0 && provenanceLinked === linkedEvidence.length
          ? "present"
          : "missing",
      derived && evidenceIds.length === 0
        ? derivedDetail
        : linkedEvidence.length > 0
        ? `${provenanceLinked}/${linkedEvidence.length} sources tied to trace steps`
        : "No evidence to tie back to trace steps.",
    ),
    control(
      "coverage",
      derived && (finding.coverage?.length ?? 0) === 0
        ? "not_applicable"
        : (finding.coverage?.length ?? 0) > 0
          ? "present"
          : "missing",
      derived && (finding.coverage?.length ?? 0) === 0
        ? `${finding.agent} findings are claim-level pipeline findings, not fragment-level verifier coverage.`
        : (finding.coverage?.length ?? 0) > 0
        ? plural(finding.coverage?.length ?? 0, "claim fragment")
        : "No fragment-level coverage matrix.",
    ),
    control(
      "source_quality",
      derived && (finding.evidence_quality?.length ?? 0) === 0
        ? "not_applicable"
        : (finding.evidence_quality?.length ?? 0) > 0
          ? "present"
          : "missing",
      derived && (finding.evidence_quality?.length ?? 0) === 0
        ? derivedDetail
        : (finding.evidence_quality?.length ?? 0) > 0
        ? plural(finding.evidence_quality?.length ?? 0, "source scored", "sources scored")
        : "No authority/freshness/directness scoring.",
    ),
    control(
      "skeptic",
      !issueNeedsChallenge
        ? "not_applicable"
        : finding.skeptic_review
          ? "present"
          : "missing",
      !issueNeedsChallenge
        ? "Only major/critical non-OK verifier findings require challenge."
        : finding.skeptic_review
          ? finding.skeptic_review.summary
          : "No independent challenge review recorded.",
    ),
    control(
      "computation",
      !needsComputation
        ? "not_applicable"
        : finding.computation_check
          ? "present"
          : "missing",
      !needsComputation
        ? "No numeric/date replay required for this claim."
        : finding.computation_check
          ? `${finding.computation_check.judgment}: ${finding.computation_check.computed_value}`
          : "No deterministic computation replay recorded.",
    ),
  ];

  const required = controls.filter((c) => c.status !== "not_applicable");
  return {
    findingId: finding.id,
    presentCount: required.filter((c) => c.status === "present").length,
    requiredCount: required.length,
    controls,
  };
}

export function getJobAuditability(job: Job): JobAuditability {
  const findings = job.findings.filter((f) => f.agent === "UnifiedVerifier");
  const claimById = new Map(job.claims.map((claim) => [claim.id, claim]));
  const perFinding = findings.map((finding) => getFindingAuditability(job, finding));
  const fullyAuditableFindings = perFinding.filter(
    (auditability) =>
      auditability.requiredCount > 0 &&
      auditability.presentCount === auditability.requiredCount,
  ).length;
  const gapRows = findings.flatMap((finding, index) => {
    const auditability = perFinding[index];
    if (!auditability || auditability.presentCount === auditability.requiredCount) {
      return [];
    }
    const missing = auditability.controls.filter((control) => control.status === "missing");
    if (missing.length === 0) {
      return [];
    }
    return [
      {
        findingId: finding.id,
        claimId: finding.claim_id,
        claimText: claimById.get(finding.claim_id)?.text ?? finding.claim_id,
        verdict: finding.verdict,
        severity: finding.severity,
        missingControlIds: missing.map((control) => control.id),
        missingControlLabels: missing.map((control) => control.label),
      },
    ];
  });
  const controls = CONTROL_ORDER.map((id) => {
    const matching = perFinding.map((auditability) =>
      auditability.controls.find((control) => control.id === id),
    );
    const required = matching.filter((control) => control?.status !== "not_applicable");
    const present = required.filter((control) => control?.status === "present").length;
    return {
      id,
      label: CONTROL_LABEL[id],
      present,
      required: required.length,
      missing: required.length - present,
    };
  });

  return {
    findings: findings.length,
    presentCount: perFinding.reduce((sum, auditability) => sum + auditability.presentCount, 0),
    requiredCount: perFinding.reduce((sum, auditability) => sum + auditability.requiredCount, 0),
    fullyAuditableFindings,
    incompleteFindings: gapRows.length,
    controls,
    gapRows,
  };
}
