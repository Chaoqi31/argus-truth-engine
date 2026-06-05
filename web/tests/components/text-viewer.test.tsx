import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TextViewer } from "@/components/text-viewer";
import type { Claim, Finding } from "@/lib/types";

const text =
  "Defendant's motion should be denied. Controlling authority squarely supports plaintiff's position.\n\n" +
  "In Shute v. Carnival Cruise Lines, 499 U.S. 585 (1991), the Supreme Court held that such clauses are unenforceable against individual consumers.";

const claimText =
  "In Shute v. Carnival Cruise Lines, 499 U.S. 585 (1991), the Supreme Court held that such clauses are unenforceable against individual consumers.";

const claim: Claim = {
  id: "c_shute",
  text: claimText,
  page: 1,
  span: [58, 120],
  type: "citation",
  importance: "high",
  extracted_metadata: {},
};

const finding: Finding = {
  id: "f_shute",
  job_id: "j1",
  claim_id: "c_shute",
  agent: "UnifiedVerifier",
  verdict: "inaccurate",
  severity: "critical",
  confidence: 0.99,
  summary: "The claim reverses Shute.",
  evidence_ids: [],
  reasoning_trace_id: "t1",
  related_finding_ids: [],
  created_at: "2026-06-05T00:00:00Z",
};

describe("TextViewer", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("uses claim text to correct stale character spans before highlighting", () => {
    const onClaimClick = vi.fn();

    render(
      <TextViewer
        text={text}
        claims={[claim]}
        findings={[finding]}
        activeFindingId={null}
        onClaimClick={onClaimClick}
      />,
    );

    const highlight = screen.getByRole("button", { name: claimText });
    expect(highlight).toHaveTextContent(/^In Shute/);
    expect(highlight).not.toHaveTextContent(/squarely supports/);

    fireEvent.click(highlight);
    expect(onClaimClick).toHaveBeenCalledWith("c_shute");
  });
});
