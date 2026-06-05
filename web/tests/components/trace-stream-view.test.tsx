import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TraceStreamView } from "@/components/trace-stream-view";
import type { Job, ReasoningTrace, Step } from "@/lib/types";

function loadSampleJob(): Job {
  return {
    id: "job_trace",
    pdf_path: "sample.pdf",
    status: "done",
    created_at: "2026-06-01T00:00:00Z",
    completed_at: "2026-06-01T00:05:00Z",
    cost_usd: 1.23,
    total_tokens: 1000,
    claims_total: 2,
    claims_audited: 2,
    audit_report_md: null,
    claims: [
      {
        id: "c_ok",
        text: "Its data-center segment alone generated $148 billion in revenue over the same fiscal year",
        page: 1,
        span: [0, 10],
        type: "numerical-data",
        importance: "high",
        extracted_metadata: {},
      },
      {
        id: "c_bad",
        text: "According to a February 2026 Goldman Sachs report titled \"Silicon Supercycle: The $5 Trillion AI Buildout,\" cumulative global spending on AI infrastructure will exceed $5 trillion by 2030",
        page: 1,
        span: [11, 20],
        type: "citation",
        importance: "high",
        extracted_metadata: {},
      },
    ],
    findings: [
      {
        id: "f_ok",
        job_id: "job_trace",
        claim_id: "c_ok",
        agent: "UnifiedVerifier",
        verdict: "ok",
        severity: "minor",
        confidence: 0.98,
        summary: "The data-center segment claim is lower priority in this fixture.",
        evidence_ids: [],
        reasoning_trace_id: "t_ok",
        related_finding_ids: [],
        created_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "f_bad",
        job_id: "job_trace",
        claim_id: "c_bad",
        agent: "UnifiedVerifier",
        verdict: "fabricated",
        severity: "major",
        confidence: 0.93,
        summary: "No record can be found of the claimed Goldman Sachs report.",
        why_wrong: "The named Silicon Supercycle report does not appear in Goldman Sachs records.",
        correct_information: {
          value: "The closest real Goldman Sachs work is Tracking Trillions.",
          source: "Goldman Sachs Global Institute",
          url: "https://www.goldmansachs.com/insights/articles/tracking-trillions-the-assumptions-shaping-scale-of-the-ai-build-out",
          retrieved_date: "2026-06-01",
        },
        reasoning_chain: [
          {
            action: "Searched for the exact report title.",
            observation: "No matching Goldman Sachs report appeared.",
            reasoning: "The exact-title miss supports a fabricated verdict.",
          },
          {
            action: "Compared nearby Goldman Sachs AI infrastructure work.",
            observation: "Tracking Trillions uses a different title and timeframe.",
            reasoning: "The nearest source does not support the claim.",
          },
        ],
        evidence_ids: ["e1", "e2"],
        reasoning_trace_id: "t_bad",
        related_finding_ids: [],
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    traces: [
      makeTrace("t_bad", "c_bad", [
        makeStep("t_bad", 1, "thinking", "Reasoning checkpoint 1"),
        makeStep("t_bad", 2, "web_search", "search: Silicon Supercycle Goldman Sachs"),
        makeStep("t_bad", 3, "web_search", "search: site:goldmansachs.com Silicon Supercycle"),
        makeStep("t_bad", 4, "web_search", "search: Tracking Trillions Goldman Sachs"),
      ]),
      makeTrace("t_ok", "c_ok", [makeStep("t_ok", 1, "thinking", "Lower priority checkpoint")]),
    ],
    evidences: [
      {
        id: "e1",
        source_type: "web_page",
        url: "https://example.com/a",
        citation: "Goldman search",
        snippet: "No exact title match.",
        full_content_ref: null,
        retrieved_at: "2026-06-01T00:00:00Z",
        retrieved_by_step_id: "t_bad-web_search-2",
      },
      {
        id: "e2",
        source_type: "web_page",
        url: "https://example.com/b",
        citation: "Tracking Trillions",
        snippet: "Different report title.",
        full_content_ref: null,
        retrieved_at: "2026-06-01T00:00:00Z",
        retrieved_by_step_id: "t_bad-web_search-4",
      },
    ],
  };
}

function makeTrace(id: string, claimId: string, steps: Step[]): ReasoningTrace {
  return {
    id,
    job_id: "job_trace",
    claim_id: claimId,
    agent: "UnifiedVerifier",
    miromind_response_id: `resp_${id}`,
    started_at: "2026-06-01T00:00:00Z",
    completed_at: "2026-06-01T00:01:00Z",
    total_tokens: 100,
    reasoning_tokens: 50,
    num_search_queries: steps.filter((step) => step.type === "web_search").length,
    final_verdict_step_id: null,
    steps,
  };
}

function makeStep(
  traceId: string,
  sequence: number,
  type: "thinking" | "web_search",
  summary: string,
): Step {
  return {
    id: `${traceId}-${type}-${sequence}`,
    trace_id: traceId,
    sequence,
    type,
    summary,
    content: {},
    evidence_ids: [],
    parent_step_id: null,
    created_at: "2026-06-01T00:00:00Z",
  };
}

describe("TraceStreamView", () => {
  it("opens the MiroMind verify walkthrough on the evidence-backed issue first", () => {
    const { container } = render(<TraceStreamView job={loadSampleJob()} />);

    const openFullTrace = screen.getByRole("button", { name: /Open full trace/i });
    expect(screen.getAllByText(/Silicon Supercycle/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/fabricated/i).length).toBeGreaterThan(0);

    const text = container.textContent ?? "";
    expect(text).toContain("2 sources");
    expect(text).toContain("2 reasoning steps");
    expect(text).toContain("3 searches");
    expect(text).toContain("Start here");
    expect(text).toContain("What Argus proved");
    expect(text).toContain("Stage overview");
    expect(text).not.toContain("Verdict brief");

    fireEvent.click(openFullTrace);
    const expandedText = container.textContent ?? "";
    expect(expandedText).toContain("Full trace workspace");
    expect(expandedText).toContain("Verify claims");
    expect(expandedText).toContain("Verdict brief");
    expect(expandedText).toContain("Why wrong");
    expect(expandedText).toContain("Correct");
    expect(expandedText).toContain("Tracking Trillions");
    expect(expandedText.indexOf("Silicon Supercycle")).toBeLessThan(
      expandedText.indexOf("data-center segment"),
    );
    expect(expandedText.indexOf("Verdict brief")).toBeLessThan(expandedText.indexOf("Reasoning checkpoint 1"));
  });

  it("uses the selected finding for the trace brief when one is active", () => {
    render(<TraceStreamView job={loadSampleJob()} activeFindingId="f_ok" />);

    expect(screen.getByText(/Its data-center segment alone generated/)).toBeInTheDocument();
    expect(screen.getByText(/The data-center segment claim is lower priority/)).toBeInTheDocument();
    expect(screen.queryByText(/No record can be found of the claimed Goldman Sachs report/)).not.toBeInTheDocument();
  });

  it("does not reuse another finding's verifier trace for derived findings", () => {
    const job = loadSampleJob();
    job.findings = [
      ...job.findings,
      {
        id: "f_derived",
        job_id: "job_trace",
        claim_id: "c_bad",
        agent: "Consistency",
        verdict: "unsupported-inference",
        severity: "major",
        confidence: 0.91,
        summary: "The claim overextends the verified evidence.",
        evidence_ids: [],
        reasoning_trace_id: "t_derived",
        related_finding_ids: ["f_bad"],
        created_at: "2026-06-01T00:00:00Z",
      },
    ];

    render(<TraceStreamView job={job} activeFindingId="f_derived" />);

    expect(screen.getByText(/Selected finding/i)).toBeInTheDocument();
    expect(screen.getByText(/pipeline-derived/i)).toBeInTheDocument();
    expect(screen.queryByText(/What Argus proved/i)).not.toBeInTheDocument();
  });

  it("explains the skeptic challenge stage with review outcomes and counterevidence", () => {
    const job = loadSampleJob();
    job.stages = [
      {
        key: "verify",
        name: "Verify",
        engine: "miromind",
        summary: "Deep-researched 2 claims",
        metrics: { n_claims: 2 },
      },
      {
        key: "skeptic",
        name: "Skeptic challenge",
        engine: "miromind",
        summary: "Challenged 1 high-risk finding · 1 counterevidence found",
        metrics: {
          n_reviewed: 1,
          n_cleared: 0,
          n_counterevidence_found: 1,
          n_inconclusive: 0,
        },
      },
    ];
    job.findings = job.findings.map((finding) =>
      finding.id === "f_bad"
        ? {
            ...finding,
            skeptic_review: {
              status: "counterevidence_found",
              summary: "A primary filing supports a narrower interpretation.",
              recommended_verdict: "uncertain",
              counterevidence: [
                {
                  source: "Issuer 20-F",
                  url: "https://example.com/20-f",
                  snippet: "The filing describes the risk as contingent.",
                  relevance: "Challenges the fabricated verdict.",
                },
              ],
            },
          }
        : finding,
    );

    render(<TraceStreamView job={job} />);
    fireEvent.click(screen.getByRole("button", { name: /Skeptic challenge/i }));

    expect(screen.getByText(/Independently challenges high-risk MiroMind verdicts/i)).toBeInTheDocument();
    expect(screen.getAllByText("reviewed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("counterevidence").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Audit ledger/i)).toBeInTheDocument();
    expect(screen.getByText(/Transparent because/i)).toBeInTheDocument();
    expect(screen.getAllByText(/counterevidence found/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/A primary filing supports a narrower interpretation/i)).toBeInTheDocument();
    expect(screen.getByText(/Issuer 20-F/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommended verdict: uncertain/i)).toBeInTheDocument();
  });
});
