import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { JobStatsBar } from "@/components/job-stats-bar";
import { useArgusStore } from "@/lib/store";
import type { Job } from "@/lib/types";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1",
    pdf_path: "x.pdf",
    status: "done",
    created_at: "2026-05-20T00:00:00Z",
    completed_at: "2026-05-20T00:10:00Z",
    cost_usd: 12.3456,
    total_tokens: 1000,
    claims_total: 10,
    claims_audited: 7,
    audit_report_md: null,
    claims: [],
    findings: [],
    traces: [],
    evidences: [],
    ...overrides,
  };
}

const REVIEW_STORAGE_KEY = "argus:finding-reviews:j1";

describe("JobStatsBar", () => {
  beforeEach(() => {
    window.localStorage.removeItem(REVIEW_STORAGE_KEY);
    useArgusStore.getState().clear();
  });

  it("shows partial coverage explicitly when not every selected claim was audited", () => {
    render(<JobStatsBar job={makeJob()} />);
    expect(screen.getByText("7/10")).toBeInTheDocument();
    expect(screen.getByText(/partial coverage/i)).toBeInTheDocument();
  });

  it("wraps stats instead of introducing a horizontal scrollbar", () => {
    const { container } = render(<JobStatsBar job={makeJob()} />);
    const bar = container.firstElementChild;

    expect(bar).toHaveClass("flex-wrap");
    expect(bar).not.toHaveClass("overflow-x-auto");
  });

  it("shows the audit cost as a visible stat", () => {
    render(<JobStatsBar job={makeJob()} />);
    expect(screen.getByText("$12.35")).toBeInTheDocument();
    expect(screen.getByText(/cost/i)).toBeInTheDocument();
  });

  it("surfaces the content domain that guided verification", () => {
    const job = { ...makeJob(), content_domain: "finance" } as Job & {
      content_domain: "finance";
    };

    render(<JobStatsBar job={job} />);

    expect(screen.getByText("finance")).toBeInTheDocument();
    expect(screen.getByText("domain")).toBeInTheDocument();
  });

  it("summarizes MiroMind tool use and token spend for reasoning transparency", () => {
    render(
      <JobStatsBar
        job={makeJob({
          total_tokens: 20000,
          traces: [
            {
              id: "t1",
              job_id: "j1",
              claim_id: "c1",
              agent: "UnifiedVerifier",
              miromind_response_id: "resp_1",
              started_at: "2026-05-20T00:00:00Z",
              completed_at: "2026-05-20T00:05:00Z",
              total_tokens: 12000,
              reasoning_tokens: 678,
              num_search_queries: 3,
              final_verdict_step_id: null,
              steps: [
                {
                  id: "s1",
                  trace_id: "t1",
                  sequence: 1,
                  type: "web_search",
                  summary: "Search exact citation.",
                  content: {},
                  evidence_ids: [],
                  parent_step_id: null,
                  created_at: "2026-05-20T00:01:00Z",
                },
                {
                  id: "s2",
                  trace_id: "t1",
                  sequence: 2,
                  type: "fetch_url_content",
                  summary: "Fetch source.",
                  content: {},
                  evidence_ids: [],
                  parent_step_id: "s1",
                  created_at: "2026-05-20T00:02:00Z",
                },
                {
                  id: "s3",
                  trace_id: "t1",
                  sequence: 3,
                  type: "fetch_url_content",
                  summary: "Fetch second source.",
                  content: {},
                  evidence_ids: [],
                  parent_step_id: "s1",
                  created_at: "2026-05-20T00:03:00Z",
                },
                {
                  id: "s4",
                  trace_id: "t1",
                  sequence: 4,
                  type: "execute_python",
                  summary: "Check calculation.",
                  content: {},
                  evidence_ids: [],
                  parent_step_id: "s2",
                  created_at: "2026-05-20T00:04:00Z",
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("tool calls")).toBeInTheDocument();
    expect(screen.getByText("3 searches · 2 fetches · 1 code step")).toBeInTheDocument();
    expect(screen.getByText("20,000")).toBeInTheDocument();
    expect(screen.getByText("tokens")).toBeInTheDocument();
    expect(screen.getByText("678 reasoning")).toBeInTheDocument();
  });

  it("surfaces execution controls that prove the deep-research runtime path", () => {
    render(
      <JobStatsBar
        job={makeJob({
          claims_total: 2,
          claims_audited: 2,
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
              evidence_ids: [],
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
                  evidence_ids: [],
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
                  evidence_ids: [],
                  parent_step_id: null,
                  created_at: "2026-05-20T00:01:00Z",
                },
              ],
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
              metrics: { n_claims: 2 },
            },
            {
              key: "skeptic",
              name: "Skeptic challenge",
              engine: "miromind",
              summary: "Challenged 1 high-risk finding",
              metrics: { n_reviewed: 1 },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("6/6")).toBeInTheDocument();
    expect(screen.getByText("exec controls")).toBeInTheDocument();
    expect(screen.getByText(/background responses/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /exec controls/i }));

    expect(screen.getByText("Background responses")).toBeInTheDocument();
    expect(screen.getByText("Resumable stream cursors")).toBeInTheDocument();
    expect(screen.getByText("Parallel verifier fan-out")).toBeInTheDocument();
    expect(screen.getByText("Review checkpoint")).toBeInTheDocument();
    expect(screen.getByText("Budget guard")).toBeInTheDocument();
    expect(screen.getByText("Skeptic fan-in")).toBeInTheDocument();
    expect(screen.getByText("2 response ids saved from MiroMind background runs")).toBeInTheDocument();
  });

  it("summarizes reviewer decisions for findings", () => {
    const job = makeJob({
      findings: [
        {
          id: "f1",
          job_id: "j1",
          claim_id: "c1",
          agent: "UnifiedVerifier",
          verdict: "fabricated",
          severity: "major",
          confidence: 0.92,
          summary: "No record found.",
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
          verdict: "ok",
          severity: "minor",
          confidence: 0.82,
          summary: "Verified.",
          evidence_ids: [],
          reasoning_trace_id: "t2",
          related_finding_ids: [],
          created_at: "2026-05-20T00:00:00Z",
        },
      ],
    });
    useArgusStore.getState().setFindingReview("j1", "f1", { status: "accepted" });

    render(<JobStatsBar job={job} />);

    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("1 accepted · 0 disputed")).toBeInTheDocument();
  });
});
