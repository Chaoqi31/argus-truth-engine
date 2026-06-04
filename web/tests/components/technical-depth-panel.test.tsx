import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TechnicalDepthPanel } from "@/components/technical-depth-panel";
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
      text: "The memo cites a Goldman report.",
      page: 1,
      span: [0, 34],
      type: "citation",
      importance: "high",
      extracted_metadata: {},
    },
    {
      id: "c2",
      text: "NVIDIA data center revenue was $148B.",
      page: 1,
      span: [35, 74],
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
      verdict: "fabricated",
      severity: "major",
      confidence: 0.94,
      summary: "No matching report was found.",
      coverage: [
        {
          claim_fragment: "Goldman report exists",
          relation: "refutes",
          evidence_ids: ["e1"],
          reason: "Exact-title search found no issuer page.",
        },
      ],
      evidence_quality: [
        {
          evidence_id: "e1",
          role: "negative evidence",
          authority: 0.82,
          independence: 0.77,
          freshness: 0.91,
          directness: 0.88,
          rationale: "The search directly probes the cited artifact.",
        },
      ],
      skeptic_review: {
        status: "no_counterevidence",
        summary: "No credible alternate title was found.",
        recommended_verdict: null,
        counterevidence: [],
      },
      evidence_ids: ["e1"],
      reasoning_trace_id: "t1",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
    {
      id: "f2",
      job_id: "j1",
      claim_id: "c2",
      agent: "UnifiedVerifier",
      verdict: "ok",
      severity: "minor",
      confidence: 0.96,
      summary: "The claim was verified.",
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
      total_tokens: 120,
      reasoning_tokens: 40,
      num_search_queries: 2,
      final_verdict_step_id: null,
      steps: [
        {
          id: "s1",
          trace_id: "t1",
          sequence: 1,
          type: "web_search",
          summary: "Search exact report title.",
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
      total_tokens: 140,
      reasoning_tokens: 50,
      num_search_queries: 3,
      final_verdict_step_id: null,
      steps: [
        {
          id: "s2",
          trace_id: "t2",
          sequence: 1,
          type: "web_search",
          summary: "Search official filing.",
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
      url: "https://example.com/search",
      citation: "Search results",
      snippet: "No exact match.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s1",
    },
    {
      id: "e2",
      source_type: "company_filing",
      url: "https://example.com/10k",
      citation: "Company filing",
      snippet: "Official revenue.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s2",
    },
  ],
  stages: [
    {
      key: "planner",
      name: "Planner",
      engine: "deepseek",
      summary: "Extracted candidate claims.",
      metrics: { n_claims: 2 },
    },
    {
      key: "review_gate",
      name: "Review gate",
      engine: "deterministic",
      summary: "2 claims selected.",
      metrics: { n_verifying: 2 },
    },
    {
      key: "verify",
      name: "Verify",
      engine: "miromind",
      summary: "Deep-researched 2 claims.",
      metrics: { n_claims: 2 },
    },
    {
      key: "skeptic",
      name: "Skeptic challenge",
      engine: "miromind",
      summary: "Challenged high-risk findings.",
      metrics: { n_reviewed: 1 },
    },
    {
      key: "confidence",
      name: "Confidence",
      engine: "deterministic",
      summary: "Scored findings.",
      metrics: { n_scored: 2 },
    },
  ],
  benchmark: {
    name: "planted benchmark",
    expected_claims: [
      { claim_id: "c1", verdict: "fabricated", rationale: "Planted fake citation." },
      { claim_id: "c2", verdict: "ok", rationale: "Control claim." },
    ],
  },
};

describe("TechnicalDepthPanel", () => {
  it("shows and expands implementation proof points for judges", () => {
    render(<TechnicalDepthPanel job={job} />);

    expect(screen.getByText("10/10")).toBeInTheDocument();
    expect(screen.getByText(/technical proof/i)).toBeInTheDocument();
    expect(screen.getByText("Judge proof strip")).toBeInTheDocument();
    expect(screen.getByText("Architecture")).toBeInTheDocument();
    expect(screen.getByText("Native trace")).toBeInTheDocument();
    expect(screen.getByText("Benchmark")).toBeInTheDocument();
    expect(screen.getByText("Skeptic")).toBeInTheDocument();
    expect(screen.getByText("Fingerprint")).toBeInTheDocument();
    expect(screen.getByText(/2\/2 exact matches/i)).toBeInTheDocument();
    const judgeStrip = screen.getByRole("region", { name: /judge proof strip/i });
    expect(within(judgeStrip).getAllByRole("listitem")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: /technical proof/i }));

    const details = screen.getByRole("region", { name: /technical proof details/i });
    expect(within(details).getByText("LangGraph multi-stage graph")).toBeInTheDocument();
    expect(within(details).getByText("MiroMind deep research")).toBeInTheDocument();
    expect(within(details).getByText("Parallel verifier fan-out")).toBeInTheDocument();
    expect(within(details).getByText("Resumable stream replay")).toBeInTheDocument();
    expect(within(details).getByText("Independent skeptic challenge")).toBeInTheDocument();
    expect(within(details).getByText("Stable audit fingerprint")).toBeInTheDocument();
    expect(within(details).getByText("Ground-truth benchmark eval")).toBeInTheDocument();
    expect(within(details).getByText(/2 response ids/i)).toBeInTheDocument();
    expect(within(details).getByText(/fnv1a64:[0-9a-f]{16}/i)).toBeInTheDocument();
    expect(within(details).getByText(/2\/2 exact verifier matches/i)).toBeInTheDocument();
  });
});
