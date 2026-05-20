import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceTab } from "@/components/evidence-tab";
import type { Job } from "@/lib/types";

const job: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: null,
  cost_usd: 0,
  total_tokens: 100,
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
      agent: "CitationVerifier",
      verdict: "fabricated",
      severity: "major",
      confidence: 0.96,
      summary: "No DOI found.",
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
      agent: "CitationVerifier",
      miromind_response_id: "r1",
      started_at: "2026-05-20T00:00:00Z",
      completed_at: null,
      total_tokens: 100,
      reasoning_tokens: 50,
      num_search_queries: 1,
      final_verdict_step_id: null,
      steps: [
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

describe("EvidenceTab", () => {
  it("shows the claim, the evidence link, and the reasoning step", () => {
    render(<EvidenceTab job={job} findingId="f1" />);
    expect(screen.getByText(/Smith \(2021\) on widgets/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Crossref query/i });
    expect(link).toHaveAttribute("href", "https://api.crossref.org/works?query=Smith");
    expect(screen.getByText(/Think about Crossref query/)).toBeInTheDocument();
  });

  it("renders empty state if findingId not found", () => {
    render(<EvidenceTab job={job} findingId="missing" />);
    expect(screen.getByText(/select a finding/i)).toBeInTheDocument();
  });
});
