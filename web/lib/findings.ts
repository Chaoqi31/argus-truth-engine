import type { Finding, FindingVerdict, Severity } from "@/lib/types";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

const VERDICT_RANK: Record<FindingVerdict, number> = {
  fabricated: 0,
  misrepresented: 1,
  inaccurate: 2,
  outdated: 3,
  contradiction: 4,
  "unsupported-inference": 5,
  overreach: 6,
  mismatch: 7,
  superseded: 8,
  stale: 9,
  "partial-match": 10,
  uncertain: 11,
  ok: 12,
};

function reviewPriority(finding: Finding): number {
  const isIssue = finding.verdict !== "ok";
  const hasEvidence = finding.evidence_ids.length > 0;
  const hasReasoning = (finding.reasoning_chain?.length ?? 0) > 0;

  if (isIssue && hasEvidence) return 0;
  if (isIssue && hasReasoning) return 1;
  if (isIssue) return 2;
  if (hasEvidence) return 3;
  return 4;
}

export function sortFindingsForReview(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    // Primary: severity (critical → major → minor) so the most important
    // findings lead the review queue.
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    // Within a severity: evidence-backed issues first, then verdict kind, then
    // confidence.
    const priority = reviewPriority(a) - reviewPriority(b);
    if (priority !== 0) return priority;
    const verdict = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
    if (verdict !== 0) return verdict;
    return b.confidence - a.confidence;
  });
}

export function pickInitialFindingId(findings: readonly Finding[]): string | null {
  return sortFindingsForReview(findings)[0]?.id ?? null;
}
