import type { FindingVerdict, Job } from "@/lib/types";

export type BenchmarkActualVerdict = FindingVerdict | "missing";

export interface BenchmarkEvaluationRow {
  claimId: string;
  expected: FindingVerdict;
  actual: BenchmarkActualVerdict;
  match: boolean;
  rationale: string;
}

export interface BenchmarkEvaluation {
  name: string;
  total: number;
  exactMatches: number;
  accuracy: number;
  expectedIssues: number;
  detectedIssues: number;
  issueRecall: number;
  falsePositives: number;
  rows: BenchmarkEvaluationRow[];
}

function isIssue(verdict: BenchmarkActualVerdict): boolean {
  return verdict !== "ok" && verdict !== "missing";
}

export function getBenchmarkEvaluation(job: Job): BenchmarkEvaluation | null {
  const expectedClaims = job.benchmark?.expected_claims ?? [];
  if (expectedClaims.length === 0) {
    return null;
  }

  const verifierFindingByClaim = new Map(
    job.findings
      .filter((finding) => finding.agent === "UnifiedVerifier")
      .map((finding) => [finding.claim_id, finding] as const),
  );
  const rows = expectedClaims.map((expected): BenchmarkEvaluationRow => {
    const actual = verifierFindingByClaim.get(expected.claim_id)?.verdict ?? "missing";
    return {
      claimId: expected.claim_id,
      expected: expected.verdict,
      actual,
      match: actual === expected.verdict,
      rationale: expected.rationale,
    };
  });
  const exactMatches = rows.filter((row) => row.match).length;
  const expectedIssues = rows.filter((row) => isIssue(row.expected)).length;
  const detectedIssues = rows.filter((row) => isIssue(row.actual)).length;
  const recalledIssues = rows.filter((row) => isIssue(row.expected) && isIssue(row.actual)).length;
  const falsePositives = rows.filter((row) => row.expected === "ok" && isIssue(row.actual)).length;

  return {
    name: job.benchmark?.name ?? "ground-truth benchmark",
    total: rows.length,
    exactMatches,
    accuracy: exactMatches / rows.length,
    expectedIssues,
    detectedIssues,
    issueRecall: expectedIssues === 0 ? 1 : recalledIssues / expectedIssues,
    falsePositives,
    rows,
  };
}
