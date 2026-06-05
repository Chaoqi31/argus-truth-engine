import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroProductMock } from "@/components/hero-product-mock";
import { LiveReasoningPanel } from "@/components/live-reasoning-panel";

describe("homepage demo mocks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the current 10-stage audit pipeline", () => {
    render(<HeroProductMock />);

    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Planner")).toBeInTheDocument();
    expect(screen.getByText("Skeptic challenge")).toBeInTheDocument();
    expect(screen.getByText("Confidence")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });

  it("uses the legal Shute source-check example instead of the stale zero-result demo", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    const { container } = render(<LiveReasoningPanel />);
    const text = container.textContent ?? "";

    expect(text).toContain("Shute holding reversal");
    expect(text).toContain("source found");
    expect(text).toContain("Supreme Court opinion via Justia");
    expect(text).toContain("inaccurate");
    expect(text).toContain("source checks");
    expect(text).not.toContain("Goldman");
    expect(text).not.toContain("Silicon Supercycle");
    expect(text).not.toContain("0 results");
  });
});
