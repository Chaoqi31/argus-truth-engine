import { describe, expect, it } from "vitest";
import { getJobExecutionControls } from "@/lib/execution-controls";
import type { Job } from "@/lib/types";

const job: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: "2026-05-20T00:10:00Z",
  cost_usd: 2.5,
  total_tokens: 1000,
  claims_total: 2,
  claims_audited: 2,
  audit_report_md: null,
  claims: [
    {
      id: "c1",
      text: "Claim one.",
      page: 1,
      span: [0, 10],
      type: "citation",
      importance: "high",
      extracted_metadata: {},
    },
    {
      id: "c2",
      text: "Claim two.",
      page: 1,
      span: [11, 20],
      type: "citation",
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
      verdict: "fabricated",
      severity: "major",
      confidence: 0.9,
      summary: "No source found.",
      evidence_ids: ["e1"],
      reasoning_trace_id: "t1",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
      skeptic_review: {
        status: "no_counterevidence",
        summary: "No counterevidence found.",
        recommended_verdict: null,
        counterevidence: [],
      },
    },
    {
      id: "f2",
      job_id: "j1",
      claim_id: "c2",
      agent: "UnifiedVerifier",
      verdict: "ok",
      severity: "minor",
      confidence: 0.95,
      summary: "Verified.",
      evidence_ids: ["e2"],
      reasoning_trace_id: "t2",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
  ],
  traces: [
    {
      id: "t1",
      job_id: "j1",
      claim_id: "c1",
      agent: "UnifiedVerifier",
      miromind_response_id: "resp_1",
      started_at: "2026-05-20T00:00:00Z",
      completed_at: "2026-05-20T00:05:00Z",
      total_tokens: 100,
      reasoning_tokens: 20,
      num_search_queries: 1,
      final_verdict_step_id: null,
      steps: [
        {
          id: "s1",
          trace_id: "t1",
          sequence: 1,
          type: "web_search",
          summary: "Search exact title.",
          content: {},
          evidence_ids: ["e1"],
          parent_step_id: null,
          created_at: "2026-05-20T00:01:00Z",
        },
      ],
    },
    {
      id: "t2",
      job_id: "j1",
      claim_id: "c2",
      agent: "UnifiedVerifier",
      miromind_response_id: "resp_2",
      started_at: "2026-05-20T00:00:00Z",
      completed_at: "2026-05-20T00:05:00Z",
      total_tokens: 100,
      reasoning_tokens: 20,
      num_search_queries: 1,
      final_verdict_step_id: null,
      steps: [
        {
          id: "s2",
          trace_id: "t2",
          sequence: 1,
          type: "web_search",
          summary: "Search source.",
          content: {},
          evidence_ids: ["e2"],
          parent_step_id: null,
          created_at: "2026-05-20T00:01:00Z",
        },
      ],
    },
  ],
  evidences: [
    {
      id: "e1",
      source_type: "web_page",
      url: "https://example.com/a",
      citation: "Source A",
      snippet: "No match.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s1",
    },
    {
      id: "e2",
      source_type: "web_page",
      url: "https://example.com/b",
      citation: "Source B",
      snippet: "Match.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s2",
    },
  ],
  stages: [
    {
      key: "review_gate",
      name: "Review gate",
      engine: "deterministic",
      summary: "2 claims selected",
      metrics: { n_verifying: 2 },
    },
    {
      key: "verify",
      name: "Verify",
      engine: "miromind",
      summary: "Deep-researched 2 claims",
      metrics: { n_claims: 2, n_steps: 2 },
    },
    {
      key: "skeptic",
      name: "Skeptic challenge",
      engine: "miromind",
      summary: "Challenged 1 high-risk finding",
      metrics: { n_reviewed: 1 },
    },
  ],
};

describe("execution controls", () => {
  it("marks runtime controls present when the job carries execution evidence", () => {
    const summary = getJobExecutionControls(job);

    expect(summary.presentCount).toBe(6);
    expect(summary.requiredCount).toBe(6);
    expect(summary.controls.map((control) => [control.id, control.status])).toEqual([
      ["background_responses", "present"],
      ["resumable_cursors", "present"],
      ["parallel_fanout", "present"],
      ["review_checkpoint", "present"],
      ["budget_guard", "present"],
      ["skeptic_fanin", "present"],
    ]);
    expect(summary.controls.find((control) => control.id === "background_responses")?.detail)
      .toContain("2 response ids");
  });

  it("treats parallel fan-out as not applicable for single-claim audits", () => {
    const singleClaimJob: Job = {
      ...job,
      claims_total: 1,
      claims_audited: 1,
      claims: [job.claims[0]!],
      findings: [job.findings[0]!],
      traces: [job.traces[0]!],
    };

    const summary = getJobExecutionControls(singleClaimJob);

    expect(summary.controls.find((control) => control.id === "parallel_fanout")?.status)
      .toBe("not_applicable");
  });
});
