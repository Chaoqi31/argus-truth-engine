import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimReviewPanel } from "@/components/claim-review-panel";
import { submitClaimSelection } from "@/lib/api";
import { useArgusStore } from "@/lib/store";
import type { ReviewClaim } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  submitClaimSelection: vi.fn().mockResolvedValue(undefined),
}));

const claims: ReviewClaim[] = [
  {
    id: "c1",
    text: "The memo cites Goldman Sachs, Tracking Trillions: A Silicon Supercycle Report.",
    type: "citation",
    importance: "high",
  },
  {
    id: "c2",
    text: "NVIDIA data-center revenue reached $47.5 billion in Q1 FY2027.",
    type: "numerical-data",
    importance: "medium",
  },
];

describe("ClaimReviewPanel", () => {
  beforeEach(() => {
    vi.mocked(submitClaimSelection).mockClear();
    window.localStorage.removeItem("argus-miromind-key");
    window.sessionStorage.removeItem("argus-miromind-key");
    useArgusStore.getState().clear();
    useArgusStore.getState().setReviewReady(claims, []);
  });

  it("gives each claim checkbox an accessible name from the claim text", () => {
    render(<ClaimReviewPanel jobId="job_1" />);

    expect(screen.getByRole("checkbox", { name: claims[0].text })).toBeChecked();
  });

  it("lets reviewers toggle a claim by clicking its claim text", () => {
    render(<ClaimReviewPanel jobId="job_1" />);

    fireEvent.click(screen.getByText(/NVIDIA data-center revenue/i));

    expect(
      screen.getByRole("button", { name: /Verify 1 claim/i }),
    ).toBeEnabled();
  });

  it("offers a high-priority shortcut to control verification cost", () => {
    render(<ClaimReviewPanel jobId="job_1" />);

    fireEvent.click(screen.getByRole("button", { name: /High only/i }));

    expect(
      screen.getByRole("checkbox", { name: /Tracking Trillions/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /NVIDIA data-center revenue/i }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Verify 1 claim/i })).toBeEnabled();
  });

  it("resumes verification with the current-session MiroMind key", () => {
    window.sessionStorage.setItem("argus-miromind-key", "session-key");
    render(<ClaimReviewPanel jobId="job_1" />);

    fireEvent.click(screen.getByRole("button", { name: /Verify 2 claims/i }));

    expect(submitClaimSelection).toHaveBeenCalledWith(
      "job_1",
      ["c1", "c2"],
      "session-key",
    );
  });
});
