import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FindingsTab } from "@/components/findings-tab";
import { useArgusStore } from "@/lib/store";
import type { Job } from "@/lib/types";

const job: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: null,
  cost_usd: 0,
  total_tokens: 0,
  audit_report_md: null,
  claims: [
    {
      id: "c1",
      text: "Smith (2021) proves the widget claim.",
      page: 1,
      span: [0, 38],
      type: "citation",
      importance: "high",
      extracted_metadata: {},
    },
    {
      id: "c2",
      text: "The citation matches Crossref.",
      page: 1,
      span: [40, 69],
      type: "citation",
      importance: "medium",
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
      summary: "No record in Crossref.",
      why_wrong: "The citation could not be found in DOI registries.",
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
      confidence: 0.85,
      summary: "Citation matches Crossref.",
      evidence_ids: [],
      reasoning_trace_id: "t2",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
  ],
  traces: [],
  evidences: [
    {
      id: "e1",
      source_type: "crossref",
      url: "https://api.crossref.org/works?query=Smith",
      citation: "Crossref query",
      snippet: "No matching DOI.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s1",
    },
  ],
};

const REVIEW_STORAGE_KEY = "argus:finding-reviews:j1";

describe("FindingsTab", () => {
  beforeEach(() => {
    window.localStorage.removeItem(REVIEW_STORAGE_KEY);
    useArgusStore.getState().clear();
  });

  it("renders each finding's summary", () => {
    render(<FindingsTab job={job} activeFindingId={null} onSelect={() => undefined} onOpenDrawer={() => undefined} />);
    expect(screen.getByText(/No record in Crossref/)).toBeInTheDocument();
    expect(screen.getByText(/Citation matches Crossref/)).toBeInTheDocument();
    expect(screen.getByText(/Smith \(2021\) proves the widget claim/)).toBeInTheDocument();
    expect(screen.getByText(/1 source/)).toBeInTheDocument();
  });

  it("calls onSelect when a card is clicked", () => {
    const handler = vi.fn();
    render(<FindingsTab job={job} activeFindingId={null} onSelect={handler} onOpenDrawer={() => undefined} />);
    fireEvent.click(screen.getByText(/No record in Crossref/));
    expect(handler).toHaveBeenCalledWith("f1");
  });

  it("sorts severity major before minor", () => {
    render(<FindingsTab job={job} activeFindingId={null} onSelect={() => undefined} onOpenDrawer={() => undefined} />);
    const items = screen.getAllByRole("button");
    expect(items[0]?.textContent).toMatch(/No record in Crossref/);
  });

  it("ranks evidence-backed review issues before source-less derived findings", () => {
    const reviewJob: Job = {
      ...job,
      findings: [
        {
          id: "f_derived",
          job_id: "j1",
          claim_id: "c2",
          agent: "Consistency",
          verdict: "contradiction",
          severity: "critical",
          confidence: 1,
          summary: "The document contradicts itself.",
          evidence_ids: [],
          reasoning_trace_id: "t0",
          related_finding_ids: [],
          created_at: "2026-05-20T00:00:00Z",
        },
        job.findings[0]!,
        job.findings[1]!,
      ],
    };

    render(<FindingsTab job={reviewJob} activeFindingId={null} onSelect={() => undefined} onOpenDrawer={() => undefined} />);

    expect(screen.getAllByRole("button")[0]?.textContent).toMatch(/No record in Crossref/);
  });

  it("shows reviewer status on finding cards", () => {
    useArgusStore.getState().setFindingReview("j1", "f1", { status: "accepted" });
    render(<FindingsTab job={job} activeFindingId={null} onSelect={() => undefined} onOpenDrawer={() => undefined} />);
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("surfaces skeptic review status on finding cards", () => {
    const skepticJob: Job = {
      ...job,
      findings: [
        {
          ...job.findings[0]!,
          skeptic_review: {
            status: "no_counterevidence",
            summary: "No credible counterevidence found.",
            recommended_verdict: null,
            counterevidence: [],
          },
        },
        {
          ...job.findings[1]!,
          verdict: "uncertain",
          skeptic_review: {
            status: "counterevidence_found",
            summary: "A credible title variant exists.",
            recommended_verdict: "uncertain",
            counterevidence: [
              {
                source: "Publisher archive",
                url: "https://publisher.example/widget",
                snippet: "Smith, 2021, Widget theorem.",
                relevance: "Could be the cited work under a variant title.",
              },
            ],
          },
        },
      ],
    };

    render(<FindingsTab job={skepticJob} activeFindingId={null} onSelect={() => undefined} onOpenDrawer={() => undefined} />);

    expect(screen.getByText("Skeptic cleared")).toBeInTheDocument();
    expect(screen.getByText("Skeptic challenged")).toBeInTheDocument();
  });
});
