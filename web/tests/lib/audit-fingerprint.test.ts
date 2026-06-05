import { describe, expect, it } from "vitest";
import { getAuditFingerprint } from "@/lib/audit-fingerprint";
import type { Job } from "@/lib/types";

const job: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: "2026-05-20T00:10:00Z",
  cost_usd: 1.25,
  total_tokens: 1000,
  claims_total: 1,
  claims_audited: 1,
  audit_report_md: null,
  claims: [
    {
      id: "c1",
      text: "The memo cites a Goldman report.",
      page: 1,
      span: [0, 34],
      type: "citation",
      importance: "high",
      extracted_metadata: { title: "Silicon Supercycle" },
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
      confidence: 0.94,
      summary: "No matching report was found.",
      reasoning_chain: [
        {
          action: "Search exact title.",
          observation: "No official result.",
          reasoning: "Missing exact-title evidence supports fabrication.",
        },
      ],
      evidence_ids: ["e1"],
      reasoning_trace_id: "t1",
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
      total_tokens: 120,
      reasoning_tokens: 40,
      num_search_queries: 2,
      final_verdict_step_id: "s1",
      steps: [
        {
          id: "s1",
          trace_id: "t1",
          sequence: 1,
          type: "web_search",
          summary: "Search exact report title.",
          content: { query: "Goldman Silicon Supercycle" },
          evidence_ids: ["e1"],
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
      url: "https://example.com/search",
      citation: "Search results",
      snippet: "No exact match.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s1",
    },
  ],
  stages: [
    {
      key: "verify",
      name: "Verify",
      engine: "miromind",
      summary: "Deep-researched 1 claim.",
      metrics: { n_claims: 1 },
    },
  ],
};

describe("audit fingerprint", () => {
  it("is stable for equivalent job data and summarizes included records", () => {
    const first = getAuditFingerprint(job);
    const second = getAuditFingerprint(JSON.parse(JSON.stringify(job)) as Job);

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.algorithm).toBe("fnv1a64");
    expect(first.included).toEqual({
      claims: 1,
      findings: 1,
      traces: 1,
      steps: 1,
      evidences: 1,
      stages: 1,
    });
  });

  it("changes when evidence content changes", () => {
    const first = getAuditFingerprint(job);
    const changed = getAuditFingerprint({
      ...job,
      evidences: [{ ...job.evidences[0]!, snippet: "Different evidence text." }],
    });

    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });
});
