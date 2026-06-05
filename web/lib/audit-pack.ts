import type { Finding, FindingReview, Job } from "@/lib/types";
import { getJobAuditability } from "@/lib/auditability";
import { getAuditFingerprint } from "@/lib/audit-fingerprint";
import { getBenchmarkEvaluation } from "@/lib/benchmark-evaluation";
import { getJobExecutionControls } from "@/lib/execution-controls";
import { getJudgeProofStrip, getTechnicalDepthProof } from "@/lib/technical-depth";
import { sortFindingsForReview } from "@/lib/findings";
import { formatNumber, formatUsd, pct, plural } from "@/lib/format";

const REVIEW_STATUS_ORDER = ["open", "accepted", "disputed", "needs-recheck", "resolved"] as const;

function cell(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function lines(parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === "string").join("\n");
}

function reviewFor(
  finding: Finding,
  reviews: Record<string, FindingReview>,
): FindingReview {
  return reviews[finding.id] ?? { status: "open", note: "", updated_at: "" };
}

function metricCell(metrics: Record<string, number>): string {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}: ${value}`).join("; ");
}

function traceToolCounts(trace: Job["traces"][number]): {
  searches: number;
  fetches: number;
  codeSteps: number;
} {
  const stepSearches = trace.steps.filter((step) => step.type === "web_search").length;
  return {
    searches: trace.num_search_queries > 0 ? trace.num_search_queries : stepSearches,
    fetches: trace.steps.filter((step) => step.type === "fetch_url_content").length,
    codeSteps: trace.steps.filter(
      (step) => step.type === "execute_python" || step.type === "execute_command",
    ).length,
  };
}

function skepticCounterevidenceCell(finding: Finding): string {
  const counterevidence = finding.skeptic_review?.counterevidence ?? [];
  return counterevidence
    .map((item) =>
      `${item.source}${item.url ? ` (${item.url})` : ""}: ${item.relevance || item.snippet}`,
    )
    .join("; ");
}

export function buildAuditPackMarkdown(
  job: Job,
  reviews: Record<string, FindingReview>,
): string {
  const contentDomain = job.content_domain ?? "general";
  const total = job.claims_total && job.claims_total > 0 ? job.claims_total : job.claims.length;
  const audited = job.claims_audited && job.claims_audited > 0
    ? job.claims_audited
    : job.findings.filter((f) => f.agent === "UnifiedVerifier").length;
  const unchecked = Math.max(0, total - audited);
  const materialIssues = job.findings.filter(
    (f) => f.verdict !== "ok" && (f.severity === "critical" || f.severity === "major"),
  );
  const highRisk = job.findings.filter((f) => f.severity === "critical");
  const claimById = new Map(job.claims.map((c) => [c.id, c]));
  const evidenceById = new Map(job.evidences.map((e) => [e.id, e]));
  const orderedFindings = sortFindingsForReview(job.findings);
  const challengedFindings = orderedFindings.filter((f) => f.skeptic_review);
  const auditability = getJobAuditability(job);
  const executionControls = getJobExecutionControls(job);
  const technicalProof = getTechnicalDepthProof(job);
  const judgeProofs = getJudgeProofStrip(job);
  const fingerprint = getAuditFingerprint(job);
  const benchmark = getBenchmarkEvaluation(job);
  const reviewCounts = REVIEW_STATUS_ORDER.reduce<Record<(typeof REVIEW_STATUS_ORDER)[number], number>>(
    (acc, status) => ({ ...acc, [status]: 0 }),
    { open: 0, accepted: 0, disputed: 0, "needs-recheck": 0, resolved: 0 },
  );
  for (const finding of job.findings) {
    reviewCounts[reviewFor(finding, reviews).status] += 1;
  }
  const toolTotals = job.traces.reduce(
    (acc, trace) => {
      const tools = traceToolCounts(trace);
      return {
        steps: acc.steps + trace.steps.length,
        searches: acc.searches + tools.searches,
        fetches: acc.fetches + tools.fetches,
        codeSteps: acc.codeSteps + tools.codeSteps,
      };
    },
    { steps: 0, searches: 0, fetches: 0, codeSteps: 0 },
  );
  const stageRows = (job.stages ?? []).map((stage) =>
    `| ${cell(stage.name)} | ${cell(stage.engine)} | ${cell(stage.summary)} | ${cell(metricCell(stage.metrics))} |`,
  );
  const stageStrategies = (job.stages ?? [])
    .filter((stage) => stage.strategy)
    .map((stage) => `- ${stage.name}: ${stage.strategy}`)
    .join("\n");
  const traceRows = job.traces.map((trace) => {
    const claim = claimById.get(trace.claim_id);
    const tools = traceToolCounts(trace);
    return `| ${cell(trace.agent)} | ${cell(claim?.text ?? trace.claim_id)} | ${trace.steps.length} | ${tools.searches} | ${tools.fetches} | ${tools.codeSteps} | ${trace.total_tokens} | ${trace.reasoning_tokens} | ${cell(trace.miromind_response_id)} |`;
  });
  const auditabilityRows = auditability.controls.map((control) => {
    const coverage = control.required > 0 ? `${control.present}/${control.required}` : "n/a";
    const missing = control.required > 0 ? String(control.missing) : "n/a";
    return `| ${cell(control.label)} | ${coverage} | ${missing} |`;
  });
  const auditabilityGapRows = auditability.gapRows.map((row) =>
    `| ${cell(row.findingId)} | ${cell(row.verdict)} | ${cell(row.claimText)} | ${cell(row.missingControlLabels.join("; "))} |`,
  );
  const executionRows = executionControls.controls.map((control) =>
    `| ${cell(control.label)} | ${cell(control.status)} | ${cell(control.detail)} |`,
  );
  const technicalRows = technicalProof.proofs.map((item) =>
    `| ${cell(item.label)} | ${cell(item.status)} | ${cell(item.evidence)} |`,
  );
  const judgeProofRows = judgeProofs.map((item) =>
    `| ${cell(item.label)} | ${cell(item.status)} | ${cell(item.detail)} |`,
  );
  const benchmarkRows = benchmark?.rows.map((row) =>
    `| ${cell(row.claimId)} | ${cell(row.expected)} | ${cell(row.actual)} | ${row.match ? "yes" : "no"} | ${cell(row.rationale)} |`,
  );
  const skepticCounts = challengedFindings.reduce(
    (acc, finding) => {
      const status = finding.skeptic_review?.status;
      if (status === "counterevidence_found") acc.counterevidenceFound += 1;
      if (status === "no_counterevidence") acc.cleared += 1;
      if (status === "inconclusive") acc.inconclusive += 1;
      return acc;
    },
    { counterevidenceFound: 0, cleared: 0, inconclusive: 0 },
  );
  const skepticRows = challengedFindings.map((finding) => {
    const claim = claimById.get(finding.claim_id);
    const review = finding.skeptic_review;
    return `| ${cell(finding.verdict)} | ${cell(review?.status)} | ${cell(review?.recommended_verdict ?? "none")} | ${cell(claim?.text ?? finding.claim_id)} | ${cell(review?.summary)} | ${cell(skepticCounterevidenceCell(finding))} |`;
  });
  const skepticSection = challengedFindings.length > 0
    ? [
        `- Reviewed findings: ${challengedFindings.length}`,
        `- Counterevidence found: ${skepticCounts.counterevidenceFound}`,
        `- Cleared by challenge: ${skepticCounts.cleared}`,
        `- Inconclusive challenge reviews: ${skepticCounts.inconclusive}`,
        "",
        "| Verdict | Skeptic Status | Recommended Verdict | Claim | Skeptic Summary | Counterevidence |",
        "| --- | --- | --- | --- | --- | --- |",
        ...skepticRows,
      ].join("\n")
    : "No independent challenge reviews were recorded.";

  const findingRegister = [
    "| Verdict | Severity | Review | Claim | Summary |",
    "| --- | --- | --- | --- | --- |",
    ...orderedFindings.map((f) => {
      const claim = claimById.get(f.claim_id);
      const review = reviewFor(f, reviews);
      return `| ${cell(f.verdict)} | ${cell(f.severity)} | ${cell(review.status)} | ${cell(claim?.text ?? f.claim_id)} | ${cell(f.summary)} |`;
    }),
  ].join("\n");

  const findingSections = orderedFindings.map((f, index) => {
    const claim = claimById.get(f.claim_id);
    const review = reviewFor(f, reviews);
    const evidenceLines = f.evidence_ids
      .map((id) => evidenceById.get(id))
      .filter((e) => e !== undefined)
      .map((e) => `- ${e.citation}${e.url ? ` (${e.url})` : ""}${e.snippet ? `: ${e.snippet}` : ""}`)
      .join("\n");
    const reasoning = (f.reasoning_chain ?? [])
      .map((step, i) => {
        if ("action" in step) {
          return `${i + 1}. ${step.action} Observation: ${step.observation} Reasoning: ${step.reasoning}`;
        }
        return `${i + 1}. ${step.step}: ${step.content}`;
      })
      .join("\n");
    const coverageLines = (f.coverage ?? [])
      .map((row) => {
        const evidence = row.evidence_ids
          .map((id) => evidenceById.get(id)?.citation ?? id)
          .join(", ");
        return `| ${cell(row.claim_fragment)} | ${cell(row.relation)} | ${cell(evidence)} | ${cell(row.reason)} |`;
      })
      .join("\n");
    const evidenceQualityLines = (f.evidence_quality ?? [])
      .map((quality) => {
        const evidence = evidenceById.get(quality.evidence_id);
        return `| ${cell(evidence?.citation ?? quality.evidence_id)} | ${cell(quality.role)} | ${pct(quality.authority)} | ${pct(quality.independence)} | ${pct(quality.freshness)} | ${pct(quality.directness)} | ${cell(quality.rationale)} |`;
      })
      .join("\n");

    return lines([
      `### Finding ${index + 1}: ${f.verdict}`,
      `Claim: ${claim?.text ?? f.claim_id}`,
      `Severity: ${f.severity}`,
      `Confidence: ${Math.round(f.confidence * 100)}%`,
      `Review decision: ${review.status}`,
      review.note ? `Reviewer note: ${review.note}` : null,
      "",
      `Summary: ${f.summary}`,
      f.why_wrong ? `Why wrong: ${f.why_wrong}` : null,
      f.correct_information
        ? `Correct information: ${f.correct_information.value} (${f.correct_information.source})`
        : null,
      reasoning ? `\nReasoning summary:\n${reasoning}` : null,
      coverageLines
        ? [
            "\nCoverage matrix:",
            "| Claim Fragment | Relation | Evidence | Reason |",
            "| --- | --- | --- | --- |",
            coverageLines,
          ].join("\n")
        : null,
      evidenceQualityLines
        ? [
            "\nEvidence quality:",
            "| Evidence | Role | Authority | Independence | Freshness | Directness | Rationale |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            evidenceQualityLines,
          ].join("\n")
        : null,
      evidenceLines ? `\nEvidence:\n${evidenceLines}` : "\nEvidence: none",
    ]);
  }).join("\n\n");

  const evidenceAppendix = [
    "| Source | Citation | URL | Snippet |",
    "| --- | --- | --- | --- |",
    ...job.evidences.map((e) =>
      `| ${cell(e.source_type)} | ${cell(e.citation)} | ${cell(e.url)} | ${cell(e.snippet)} |`,
    ),
  ].join("\n");

  return lines([
    "# Argus Audit Pack",
    "",
    "## Executive Summary",
    `- Status: ${unchecked > 0 || job.status === "failed" || job.status === "interrupted" ? "Partial" : "Complete"}`,
    `- Content domain: ${contentDomain}`,
    `- Checked claims: ${audited}/${total}`,
    `- Material issues: ${materialIssues.length}`,
    `- High-risk findings: ${highRisk.length}`,
    `- Cited sources: ${job.evidences.length}`,
    `- Review decisions: ${REVIEW_STATUS_ORDER.map((status) => `${status}: ${reviewCounts[status]}`).join("; ")}`,
    `- Estimated cost: ${formatUsd(job.cost_usd)}`,
    `- Tokens: ${formatNumber(job.total_tokens)}`,
    `- Tool use: ${plural(toolTotals.steps, "step")}; ${plural(toolTotals.searches, "search", "searches")}; ${plural(toolTotals.fetches, "fetch", "fetches")}; ${plural(toolTotals.codeSteps, "code step")}`,
    "",
    "## Coverage Statement",
    `This audit checked ${audited} of ${total} selected factual claims. ${unchecked} claims were left unchecked.`,
    "",
    "## Auditability Controls",
    `- Controls present: ${auditability.presentCount}/${auditability.requiredCount}`,
    `- Verifier findings assessed: ${auditability.findings}`,
    `- Fully audit-ready findings: ${auditability.fullyAuditableFindings}/${auditability.findings}`,
    [
      "| Control | Present | Missing |",
      "| --- | --- | --- |",
      ...auditabilityRows,
    ].join("\n"),
    "",
    "## Auditability Gap Register",
    auditability.gapRows.length > 0
      ? [
          `- Findings with open auditability gaps: ${auditability.incompleteFindings}`,
          "",
          "| Finding | Verdict | Claim | Missing Controls |",
          "| --- | --- | --- | --- |",
          ...auditabilityGapRows,
        ].join("\n")
      : "All verifier findings have every applicable auditability control.",
    "",
    "## Execution Controls",
    `- Controls present: ${executionControls.presentCount}/${executionControls.requiredCount}`,
    [
      "| Control | Status | Evidence |",
      "| --- | --- | --- |",
      ...executionRows,
    ].join("\n"),
    "",
    "## Technical Implementation Proof",
    `- Proof points present: ${technicalProof.presentCount}/${technicalProof.requiredCount}`,
    [
      "| Proof Point | Status | Evidence |",
      "| --- | --- | --- |",
      ...technicalRows,
    ].join("\n"),
    "",
    "## Judge Proof Strip",
    [
      "| Proof | Status | Evidence |",
      "| --- | --- | --- |",
      ...judgeProofRows,
    ].join("\n"),
    "",
    "## Audit Fingerprint",
    `- Algorithm: ${fingerprint.algorithm}`,
    `- Fingerprint: ${fingerprint.fingerprint}`,
    `- Included records: claims ${fingerprint.included.claims}; findings ${fingerprint.included.findings}; traces ${fingerprint.included.traces}; steps ${fingerprint.included.steps}; evidences ${fingerprint.included.evidences}; stages ${fingerprint.included.stages}`,
    "",
    "## Benchmark Evaluation",
    benchmark
      ? [
          `- Benchmark: ${benchmark.name}`,
          `- Exact verifier matches: ${benchmark.exactMatches}/${benchmark.total}`,
          `- Accuracy: ${pct(benchmark.accuracy)}`,
          `- Issue recall: ${pct(benchmark.issueRecall)}`,
          `- False positives: ${benchmark.falsePositives}`,
          "",
          "| Claim | Expected | Actual | Match | Rationale |",
          "| --- | --- | --- | --- | --- |",
          ...(benchmarkRows ?? []),
        ].join("\n")
      : "No ground-truth benchmark labels were supplied for this job.",
    "",
    "## Reasoning Transparency",
    stageRows.length > 0
      ? [
          "| Stage | Engine | Output | Metrics |",
          "| --- | --- | --- | --- |",
          ...stageRows,
        ].join("\n")
      : "No pipeline stages were recorded.",
    stageStrategies ? `\nStage strategies:\n${stageStrategies}` : null,
    "",
    "## Trace Inventory",
    traceRows.length > 0
      ? [
          "| Agent | Claim | Steps | Searches | Fetches | Code Steps | Tokens | Reasoning Tokens | MiroMind Response |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          ...traceRows,
        ].join("\n")
      : "No MiroMind traces were recorded.",
    "",
    "## Independent Challenge Pass",
    skepticSection,
    "",
    "## Finding Register",
    findingRegister,
    "",
    "## Claim-Level Findings",
    findingSections || "No findings recorded.",
    "",
    "## Evidence Appendix",
    evidenceAppendix,
  ]);
}
