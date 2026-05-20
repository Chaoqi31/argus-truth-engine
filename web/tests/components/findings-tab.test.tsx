import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FindingsTab } from "@/components/findings-tab";
import type { Job } from "@/lib/types";

const job: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: null,
  cost_usd: 0,
  total_tokens: 0,
  claims: [],
  findings: [
    {
      id: "f1",
      job_id: "j1",
      claim_id: "c1",
      agent: "CitationVerifier",
      verdict: "fabricated",
      severity: "major",
      confidence: 0.96,
      summary: "No record in Crossref.",
      evidence_ids: [],
      reasoning_trace_id: "t1",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
    {
      id: "f2",
      job_id: "j1",
      claim_id: "c2",
      agent: "CitationVerifier",
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
  evidences: [],
};

describe("FindingsTab", () => {
  it("renders each finding's summary", () => {
    render(<FindingsTab job={job} activeFindingId={null} onSelect={() => undefined} />);
    expect(screen.getByText(/No record in Crossref/)).toBeInTheDocument();
    expect(screen.getByText(/Citation matches Crossref/)).toBeInTheDocument();
  });

  it("calls onSelect when a card is clicked", () => {
    const handler = vi.fn();
    render(<FindingsTab job={job} activeFindingId={null} onSelect={handler} />);
    fireEvent.click(screen.getByText(/No record in Crossref/));
    expect(handler).toHaveBeenCalledWith("f1");
  });

  it("sorts severity major before minor", () => {
    render(<FindingsTab job={job} activeFindingId={null} onSelect={() => undefined} />);
    const items = screen.getAllByRole("button");
    expect(items[0]?.textContent).toMatch(/No record in Crossref/);
  });
});
