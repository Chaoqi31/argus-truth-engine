import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/cockpit/command-palette";
import { useArgusStore } from "@/lib/store";
import type { Job } from "@/lib/types";

const job: Job = {
  id: "job_1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: "2026-05-20T00:10:00Z",
  cost_usd: 1.25,
  total_tokens: 1000,
  claims_total: 1,
  claims_audited: 1,
  audit_report_md: "Executive summary",
  claims: [
    {
      id: "c1",
      text: "The memo cites Goldman Sachs, Tracking Trillions: A Silicon Supercycle Report.",
      page: 1,
      span: [0, 85],
      type: "citation",
      importance: "high",
      extracted_metadata: {},
    },
  ],
  findings: [
    {
      id: "f1",
      job_id: "job_1",
      claim_id: "c1",
      agent: "UnifiedVerifier",
      verdict: "fabricated",
      severity: "major",
      confidence: 0.94,
      summary: "No matching Goldman report was found.",
      why_wrong: "The named report does not appear in public source records.",
      reasoning_chain: [
        {
          action: "Searched for the exact report title.",
          observation: "No matching report appeared.",
          reasoning: "The absence of a source record supports a fabricated verdict.",
        },
      ],
      evidence_ids: ["e1"],
      reasoning_trace_id: "t1",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
  ],
  traces: [],
  evidences: [
    {
      id: "e1",
      source_type: "web_page",
      url: "https://example.com/search",
      citation: "Search results",
      snippet: "No exact title match.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s1",
    },
  ],
};

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useArgusStore.getState().clear();
  });

  it("exports the reviewer-ready Audit Pack from the command palette", async () => {
    let exportedBlob: Blob | null = null;
    let exportedFilename = "";

    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      exportedBlob = blob as Blob;
      return "blob:argus-audit-pack";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
      exportedFilename = this.download;
    });

    useArgusStore.getState().setJob(job);
    useArgusStore.getState().setFindingReview("job_1", "f1", {
      status: "disputed",
      note: "Reviewer wants another source before sign-off.",
    });
    useArgusStore.getState().setPaletteOpen(true);

    render(<CommandPalette />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "audit pack" } });
    fireEvent.click(screen.getByText("Export Audit Pack"));

    expect(exportedFilename).toBe("argus-audit-pack-job_1.md");
    expect(exportedBlob).not.toBeNull();
    await expect(exportedBlob!.text()).resolves.toContain("# Argus Audit Pack");
    await expect(exportedBlob!.text()).resolves.toContain("Review decision: disputed");
    await expect(exportedBlob!.text()).resolves.toContain("Reviewer wants another source");
  });
});
