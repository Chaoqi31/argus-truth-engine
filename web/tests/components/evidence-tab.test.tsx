import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { EvidenceTab } from "@/components/evidence-tab";
import { useArgusStore } from "@/lib/store";
import type { Job } from "@/lib/types";

const job: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: null,
  cost_usd: 0,
  total_tokens: 100,
  audit_report_md: null,
  claims: [
    {
      id: "c1",
      text: "Smith (2021) on widgets.",
      page: 1,
      span: [0, 22],
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
      confidence: 0.96,
      summary: "No DOI found.",
      why_wrong: "The cited paper does not appear in authoritative registries.",
      reasoning_chain: [
        {
          action: "Searched Crossref and Semantic Scholar for the exact title.",
          observation: "No matching paper or DOI was found.",
          reasoning: "The missing registry match makes the citation likely fabricated.",
        },
      ],
      coverage: [
        {
          claim_fragment: "Smith (2021) on widgets exists",
          relation: "refutes",
          evidence_ids: ["e1"],
          reason: "Crossref returned no matching DOI for the exact citation.",
        },
      ],
      evidence_quality: [
        {
          evidence_id: "e1",
          authority: 0.92,
          independence: 0.75,
          freshness: 0.98,
          directness: 0.9,
          role: "primary_source",
          rationale: "Crossref is the authoritative DOI registry for academic citations.",
        },
      ],
      skeptic_review: {
        status: "no_counterevidence",
        summary: "No credible title variant or author/year mismatch was found.",
        recommended_verdict: null,
        counterevidence: [],
      },
      computation_check: {
        kind: "numeric",
        claimed_value: "230% YoY growth",
        extracted_values: [
          {
            label: "FY2024 revenue",
            value: "47.5",
            unit: "B USD",
            source_evidence_id: "e1",
          },
        ],
        formula: "(47.5 - 15.0) / 15.0 * 100",
        computed_value: "216.7%",
        tolerance: "rounding",
        judgment: "refutes",
        rationale: "The computed value is below the claimed growth rate.",
      },
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
      miromind_response_id: "r1",
      started_at: "2026-05-20T00:00:00Z",
      completed_at: null,
      total_tokens: 100,
      reasoning_tokens: 50,
      num_search_queries: 1,
      final_verdict_step_id: null,
      steps: [
        {
          id: "s0",
          trace_id: "t1",
          sequence: 0,
          type: "web_search",
          summary: "search: Smith 2021 widgets DOI",
          content: {
            result: JSON.stringify({ organic: [] }),
          },
          evidence_ids: [],
          parent_step_id: null,
          created_at: "2026-05-20T00:00:00Z",
        },
        {
          id: "s1",
          trace_id: "t1",
          sequence: 1,
          type: "thinking",
          summary: "Think about Crossref query.",
          content: {},
          evidence_ids: [],
          parent_step_id: null,
          created_at: "2026-05-20T00:00:00Z",
        },
      ],
    },
  ],
  evidences: [
    {
      id: "e1",
      source_type: "crossref",
      url: "https://api.crossref.org/works?query=Smith",
      citation: "Crossref query",
      snippet: "{}",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s1",
    },
  ],
};

const REVIEW_STORAGE_KEY = "argus:finding-reviews:j1";

describe("EvidenceTab", () => {
  beforeEach(() => {
    window.localStorage.removeItem(REVIEW_STORAGE_KEY);
    useArgusStore.getState().clear();
  });

  it("shows the claim, the evidence link, and the reasoning step", () => {
    render(<EvidenceTab job={job} findingId="f1" />);
    expect(screen.getAllByText("Smith (2021) on widgets.").length).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: /Crossref query/i });
    expect(link).toHaveAttribute("href", "https://api.crossref.org/works?query=Smith");
    expect(screen.getByText(/Think about Crossref query/)).toBeInTheDocument();
  });

  it("allows long trace step summaries to wrap inside the evidence console", () => {
    render(<EvidenceTab job={job} findingId="f1" />);

    const stepButton = screen.getByRole("button", { name: "Show step 1 in the trace" });
    const summary = stepButton.querySelector("span:last-child");

    expect(stepButton).toHaveClass("min-w-0");
    expect(summary).toHaveClass("min-w-0");
    expect(summary).toHaveClass("break-words");
  });

  it("shows a structured reasoning summary before the raw trace", () => {
    render(<EvidenceTab job={job} findingId="f1" />);
    expect(screen.getByText(/Reasoning summary/i)).toBeInTheDocument();
    expect(screen.getByText(/Searched Crossref and Semantic Scholar/)).toBeInTheDocument();
    expect(screen.getByText(/No matching paper or DOI was found/)).toBeInTheDocument();
    expect(screen.getByText(/likely fabricated/)).toBeInTheDocument();
  });

  it("shows claim coverage, evidence quality, skeptic review, and computation checks", () => {
    render(<EvidenceTab job={job} findingId="f1" />);
    expect(screen.getByText(/Transparency checklist/i)).toBeInTheDocument();
    expect(screen.getByText(/7\/7 controls present/i)).toBeInTheDocument();
    expect(screen.getByText(/Reasoning trace/i)).toBeInTheDocument();
    expect(screen.getByText(/Evidence-to-step provenance/i)).toBeInTheDocument();
    expect(screen.getByText(/Claimed vs verified/i)).toBeInTheDocument();
    expect(screen.getAllByText(/authoritative registries/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Coverage matrix/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Smith \(2021\) on widgets exists/)).toBeInTheDocument();
    expect(screen.getAllByText(/refutes/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Evidence quality/i)).toBeInTheDocument();
    expect(screen.getByText(/primary source/i)).toBeInTheDocument();
    expect(screen.getAllByText(/freshness 98%/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /compare/i })).toBeInTheDocument();
    expect(screen.getByText(/Search trail/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Smith 2021 widgets DOI/).length).toBeGreaterThan(0);
    expect(screen.getByText(/authoritative DOI registry/)).toBeInTheDocument();
    expect(screen.getByText(/Skeptic review/i)).toBeInTheDocument();
    expect(screen.getAllByText(/No credible title variant/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Computation check/i)).toBeInTheDocument();
    expect(screen.getAllByText(/216.7%/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\(47.5 - 15.0\) \/ 15.0 \* 100/)).toBeInTheDocument();
  });

  it("lets a reviewer set a decision and note for the finding", () => {
    render(<EvidenceTab job={job} findingId="f1" />);
    expect(screen.getByText(/Review decision/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /accepted/i }));
    fireEvent.change(screen.getByPlaceholderText(/reviewer note/i), {
      target: { value: "Accepted for committee pack." },
    });

    expect(useArgusStore.getState().findingReviews.f1?.status).toBe("accepted");
    expect(useArgusStore.getState().findingReviews.f1?.note).toBe(
      "Accepted for committee pack.",
    );
  });

  it("explains source-less derived pipeline findings", () => {
    const derivedJob: Job = {
      ...job,
      claims: [
        ...job.claims,
        {
          id: "c2",
          text: "The brief draws an unsupported legal inference.",
          page: 1,
          span: [23, 68],
          type: "qualitative",
          importance: "high",
          extracted_metadata: {},
        },
      ],
      findings: [
        ...job.findings,
        {
          id: "f2",
          job_id: "j1",
          claim_id: "c2",
          agent: "Consistency",
          verdict: "unsupported-inference",
          severity: "major",
          confidence: 0.95,
          summary: "The inference is not supported by the verified claims.",
          why_wrong: "The brief extends beyond the holdings verified elsewhere.",
          evidence_ids: [],
          reasoning_trace_id: "t2",
          related_finding_ids: [],
          created_at: "2026-05-20T00:00:00Z",
        },
      ],
      traces: [
        ...job.traces,
        {
          id: "t2",
          job_id: "j1",
          claim_id: "c2",
          agent: "Consistency",
          miromind_response_id: "deepseek:consistency",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: null,
          total_tokens: 40,
          reasoning_tokens: 0,
          num_search_queries: 0,
          final_verdict_step_id: null,
          steps: [
            {
              id: "s2",
              trace_id: "t2",
              sequence: 1,
              type: "message",
              summary: "Checked claim against verified holdings.",
              content: {},
              evidence_ids: [],
              parent_step_id: null,
              created_at: "2026-05-20T00:00:00Z",
            },
          ],
        },
      ],
    };

    render(<EvidenceTab job={derivedJob} findingId="f2" />);

    expect(screen.getByText(/Derived pipeline finding/i)).toBeInTheDocument();
    expect(screen.getByText(/rather than a new external-source lookup/i)).toBeInTheDocument();
    expect(screen.getByText(/1\/1 controls present/i)).toBeInTheDocument();
    expect(screen.getAllByText(/does not create new external-source evidence/i).length).toBeGreaterThan(0);
  });

  it("renders empty state if findingId not found", () => {
    render(<EvidenceTab job={job} findingId="missing" />);
    expect(screen.getByText(/select a finding/i)).toBeInTheDocument();
  });
});
