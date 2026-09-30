import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReasoningWalkthroughCta } from "@/components/reasoning-walkthrough-cta";
import type { Finding, Job, ReasoningTrace, Step } from "@/lib/types";
import {
  makeClaim,
  makeFinding as baseFinding,
  makeJob as baseJob,
  makeStep as baseStep,
  makeTrace as baseTrace,
} from "@/tests/factories";

function makeFinding(overrides: Partial<Finding>): Finding {
  return baseFinding({
    confidence: 0.8,
    summary: "Verified.",
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  });
}

function makeStep(traceId: string, id: string, type: Step["type"]): Step {
  return baseStep({
    id,
    trace_id: traceId,
    sequence: 1,
    type,
    summary: `${type} step`,
    created_at: "2026-06-01T00:00:00Z",
  });
}

function makeTrace(id: string, claimId: string, steps: Step[]): ReasoningTrace {
  return baseTrace({
    id,
    claim_id: claimId,
    miromind_response_id: `resp_${id}`,
    started_at: "2026-06-01T00:00:00Z",
    completed_at: "2026-06-01T00:03:00Z",
    total_tokens: 500,
    reasoning_tokens: 120,
    num_search_queries: steps.filter((step) => step.type === "web_search").length,
    steps,
  });
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return baseJob({
    id: "job_1",
    pdf_path: "x.pdf",
    status: "done",
    created_at: "2026-06-01T00:00:00Z",
    completed_at: "2026-06-01T00:10:00Z",
    cost_usd: 1.25,
    total_tokens: 1000,
    claims_total: 2,
    claims_audited: 2,
    audit_report_md: null,
    claims: [
      makeClaim({
        id: "c1",
        text: "The memo cites a fabricated Goldman report.",
        page: 1,
        span: [0, 44],
        type: "citation",
        importance: "high",
        extracted_metadata: {},
        context: "",
      }),
      makeClaim({
        id: "c2",
        text: "NVIDIA was founded in 1993.",
        page: 1,
        span: [45, 73],
        type: "qualitative",
        importance: "medium",
        extracted_metadata: {},
        context: "",
      }),
    ],
    findings: [
      makeFinding({
        id: "f_ok",
        claim_id: "c2",
        verdict: "ok",
        severity: "minor",
        summary: "This fact is verified.",
        reasoning_trace_id: "t_ok",
      }),
      makeFinding({
        id: "f_bad",
        claim_id: "c1",
        verdict: "fabricated",
        severity: "major",
        confidence: 0.94,
        summary: "No record can be found of the Goldman report.",
        evidence_ids: ["e1", "e2"],
        reasoning_trace_id: "t_bad",
        reasoning_chain: [
          {
            action: "Searched exact title.",
            observation: "No match.",
            reasoning: "The missing exact-title match supports the verdict.",
          },
        ],
      }),
    ],
    traces: [
      makeTrace("t_ok", "c2", [makeStep("t_ok", "s_ok_1", "thinking")]),
      makeTrace("t_bad", "c1", [
        makeStep("t_bad", "s_bad_1", "thinking"),
        makeStep("t_bad", "s_bad_2", "web_search"),
        makeStep("t_bad", "s_bad_3", "web_search"),
      ]),
    ],
    evidences: [
      {
        id: "e1",
        source_type: "web_page",
        url: "https://example.com/a",
        citation: "Search result A",
        snippet: "No exact title match.",
        retrieved_at: "2026-06-01T00:00:00Z",
        retrieved_by_step_id: "s_bad_2",
      },
      {
        id: "e2",
        source_type: "web_page",
        url: "https://example.com/b",
        citation: "Search result B",
        snippet: "Different Goldman report.",
        retrieved_at: "2026-06-01T00:00:00Z",
        retrieved_by_step_id: "s_bad_3",
      },
    ],
    ...overrides,
  });
}

describe("ReasoningWalkthroughCta", () => {
  it("starts with the highest-risk trace-backed finding", () => {
    const onStart = vi.fn();
    render(<ReasoningWalkthroughCta job={makeJob()} onStart={onStart} />);

    fireEvent.click(screen.getByRole("button", { name: /walk through reasoning/i }));

    expect(onStart).toHaveBeenCalledWith("f_bad");
    expect(screen.getByText(/fabricated/i)).toBeInTheDocument();
    expect(screen.getByText(/3 steps/i)).toBeInTheDocument();
    expect(screen.getByText(/2 searches/i)).toBeInTheDocument();
    expect(screen.getByText(/2 sources/i)).toBeInTheDocument();
    expect(screen.queryByText(/reasoning tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tool calls/i)).not.toBeInTheDocument();
  });

  it("keeps token counts out of the conclusion layer", () => {
    const job = makeJob();
    const traces = job.traces.map((trace) =>
      trace.id === "t_bad" ? { ...trace, total_tokens: 500, reasoning_tokens: 0 } : trace,
    );

    render(<ReasoningWalkthroughCta job={{ ...job, traces }} onStart={vi.fn()} />);

    expect(screen.queryByText(/500 total tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 reasoning tokens/i)).not.toBeInTheDocument();
  });

  it("is disabled when no finding has a saved reasoning trace", () => {
    const onStart = vi.fn();
    render(<ReasoningWalkthroughCta job={makeJob({ traces: [] })} onStart={onStart} />);

    const button = screen.getByRole("button", { name: /walk through reasoning/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/no saved trace/i)).toBeInTheDocument();

    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
  });
});
