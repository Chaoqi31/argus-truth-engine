import { describe, expect, it } from "vitest";
import { buildLanes } from "@/components/cockpit/parallel-fanout";
import type { Job } from "@/lib/types";

// ---------------------------------------------------------------------------
// Minimal Job stub — only the fields buildLanes reads.
// ---------------------------------------------------------------------------

const minimalJob: Job = {
  id: "job-1",
  pdf_path: "/tmp/test.pdf",
  status: "done",
  created_at: "2026-01-01T00:00:00Z",
  completed_at: "2026-01-01T00:01:00Z",
  cost_usd: 0,
  total_tokens: 100,
  audit_report_md: null,
  evidences: [],
  claims: [
    {
      id: "claim-a",
      text: "Claim A text",
      page: 1,
      span: [0, 10],
      type: "citation",
      importance: "high",
      extracted_metadata: {},
    },
    {
      id: "claim-b",
      text: "Claim B text",
      page: 2,
      span: [11, 20],
      type: "numerical-data",
      importance: "medium",
      extracted_metadata: {},
    },
  ],
  traces: [
    {
      id: "trace-a",
      job_id: "job-1",
      claim_id: "claim-a",
      agent: "verifier",
      miromind_response_id: "resp-a",
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:30Z",
      total_tokens: 50,
      reasoning_tokens: 20,
      num_search_queries: 2,
      final_verdict_step_id: "step-a2",
      steps: [
        {
          id: "step-a1",
          trace_id: "trace-a",
          sequence: 0,
          type: "thinking",
          summary: "Thinking step",
          content: {},
          evidence_ids: [],
          parent_step_id: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "step-a2",
          trace_id: "trace-a",
          sequence: 1,
          type: "web_search",
          summary: "Search step",
          content: {},
          evidence_ids: [],
          parent_step_id: null,
          created_at: "2026-01-01T00:00:05Z",
        },
      ],
    },
    {
      id: "trace-b",
      job_id: "job-1",
      claim_id: "claim-b",
      agent: "verifier",
      miromind_response_id: "resp-b",
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:30Z",
      total_tokens: 50,
      reasoning_tokens: 20,
      num_search_queries: 1,
      final_verdict_step_id: null,
      steps: [
        {
          id: "step-b1",
          trace_id: "trace-b",
          sequence: 0,
          type: "fetch_url_content",
          summary: "Fetch step",
          content: {},
          evidence_ids: [],
          parent_step_id: null,
          created_at: "2026-01-01T00:00:01Z",
        },
      ],
    },
  ],
  findings: [
    {
      id: "finding-a",
      job_id: "job-1",
      claim_id: "claim-a",
      agent: "verifier",
      verdict: "ok",
      severity: "minor",
      confidence: 0.9,
      summary: "Looks correct",
      evidence_ids: [],
      reasoning_trace_id: "trace-a",
      related_finding_ids: [],
      created_at: "2026-01-01T00:01:00Z",
    },
    {
      id: "finding-b",
      job_id: "job-1",
      claim_id: "claim-b",
      agent: "verifier",
      verdict: "mismatch",
      severity: "major",
      confidence: 0.75,
      summary: "Value differs",
      evidence_ids: [],
      reasoning_trace_id: "trace-b",
      related_finding_ids: [],
      created_at: "2026-01-01T00:01:00Z",
    },
  ],
};

// ---------------------------------------------------------------------------

describe("buildLanes", () => {
  it("returns one lane per non-empty trace", () => {
    const lanes = buildLanes(minimalJob);
    expect(lanes).toHaveLength(2);
  });

  it("resolves claimText from the claims array", () => {
    const lanes = buildLanes(minimalJob);
    const laneA = lanes.find((l) => l.traceId === "trace-a");
    const laneB = lanes.find((l) => l.traceId === "trace-b");
    expect(laneA?.claimText).toBe("Claim A text");
    expect(laneB?.claimText).toBe("Claim B text");
  });

  it("resolves verdict from matching finding", () => {
    const lanes = buildLanes(minimalJob);
    const laneA = lanes.find((l) => l.traceId === "trace-a");
    const laneB = lanes.find((l) => l.traceId === "trace-b");
    expect(laneA?.verdict).toBe("ok");
    expect(laneB?.verdict).toBe("mismatch");
  });

  it("presentPhases contains step types that appeared in the trace", () => {
    const lanes = buildLanes(minimalJob);
    const laneA = lanes.find((l) => l.traceId === "trace-a");
    expect(laneA?.presentPhases.has("thinking")).toBe(true);
    expect(laneA?.presentPhases.has("web_search")).toBe(true);
    // final_verdict_step_id is set → "message" should be added
    expect(laneA?.presentPhases.has("message")).toBe(true);

    const laneB = lanes.find((l) => l.traceId === "trace-b");
    expect(laneB?.presentPhases.has("fetch_url_content")).toBe(true);
    // no final_verdict_step_id → "message" should NOT be present
    expect(laneB?.presentPhases.has("message")).toBe(false);
  });

  it("filters out traces with no steps", () => {
    const jobWithEmptyTrace: Job = {
      ...minimalJob,
      traces: [
        ...minimalJob.traces,
        {
          id: "trace-empty",
          job_id: "job-1",
          claim_id: "claim-a",
          agent: "verifier",
          miromind_response_id: "resp-c",
          started_at: "2026-01-01T00:00:00Z",
          completed_at: null,
          total_tokens: 0,
          reasoning_tokens: 0,
          num_search_queries: 0,
          final_verdict_step_id: null,
          steps: [],
        },
      ],
    };
    const lanes = buildLanes(jobWithEmptyTrace);
    expect(lanes.every((l) => l.traceId !== "trace-empty")).toBe(true);
    expect(lanes).toHaveLength(2);
  });
});
