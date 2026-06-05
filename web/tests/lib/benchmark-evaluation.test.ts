import { describe, expect, it } from "vitest";
import { getBenchmarkEvaluation } from "@/lib/benchmark-evaluation";
import type { Job } from "@/lib/types";

const job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: "2026-05-20T00:10:00Z",
  cost_usd: 1,
  total_tokens: 1000,
  claims_total: 3,
  claims_audited: 3,
  audit_report_md: null,
  claims: [
    {
      id: "c1",
      text: "Known good claim.",
      page: 1,
      span: [0, 17],
      type: "qualitative",
      importance: "medium",
      extracted_metadata: {},
    },
    {
      id: "c2",
      text: "Known fabricated citation.",
      page: 1,
      span: [18, 43],
      type: "citation",
      importance: "high",
      extracted_metadata: {},
    },
    {
      id: "c3",
      text: "Known numeric error.",
      page: 1,
      span: [44, 64],
      type: "numerical-data",
      importance: "high",
      extracted_metadata: {},
    },
  ],
  findings: [
    {
      id: "f1",
      job_id: "j1",
      claim_id: "c1",
      agent: "UnifiedVerifier",
      verdict: "ok",
      severity: "minor",
      confidence: 0.9,
      summary: "Verified.",
      evidence_ids: [],
      reasoning_trace_id: "t1",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
    {
      id: "f2",
      job_id: "j1",
      claim_id: "c2",
      agent: "UnifiedVerifier",
      verdict: "fabricated",
      severity: "major",
      confidence: 0.9,
      summary: "Fabricated.",
      evidence_ids: [],
      reasoning_trace_id: "t2",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
    {
      id: "f3",
      job_id: "j1",
      claim_id: "c3",
      agent: "UnifiedVerifier",
      verdict: "inaccurate",
      severity: "major",
      confidence: 0.9,
      summary: "Inaccurate.",
      evidence_ids: [],
      reasoning_trace_id: "t3",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
  ],
  traces: [],
  evidences: [],
  benchmark: {
    name: "planted demo benchmark",
    expected_claims: [
      { claim_id: "c1", verdict: "ok", rationale: "Control claim." },
      { claim_id: "c2", verdict: "fabricated", rationale: "Planted fake citation." },
      { claim_id: "c3", verdict: "inaccurate", rationale: "Planted wrong number." },
    ],
  },
} satisfies Job;

describe("benchmark evaluation", () => {
  it("scores verifier verdicts against fixture ground truth", () => {
    const evaluation = getBenchmarkEvaluation(job);

    expect(evaluation).not.toBeNull();
    expect(evaluation?.name).toBe("planted demo benchmark");
    expect(evaluation?.total).toBe(3);
    expect(evaluation?.exactMatches).toBe(3);
    expect(evaluation?.accuracy).toBe(1);
    expect(evaluation?.issueRecall).toBe(1);
    expect(evaluation?.falsePositives).toBe(0);
    expect(evaluation?.rows.map((row) => [row.claimId, row.expected, row.actual, row.match])).toEqual([
      ["c1", "ok", "ok", true],
      ["c2", "fabricated", "fabricated", true],
      ["c3", "inaccurate", "inaccurate", true],
    ]);
  });

  it("returns null for live jobs without fixture ground truth", () => {
    const evaluation = getBenchmarkEvaluation({ ...job, benchmark: undefined });

    expect(evaluation).toBeNull();
  });
});
