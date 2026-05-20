import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeverityBadge } from "@/components/severity-badge";

describe("SeverityBadge", () => {
  it("renders the severity label", () => {
    render(<SeverityBadge severity="major" />);
    expect(screen.getByText(/major/i)).toBeInTheDocument();
  });

  it("applies a colour class per severity", () => {
    const { rerender } = render(<SeverityBadge severity="critical" data-testid="b" />);
    expect(screen.getByTestId("b").className).toMatch(/destructive|red/);
    rerender(<SeverityBadge severity="minor" data-testid="b" />);
    expect(screen.getByTestId("b").className).toMatch(/muted|gray/);
  });
});
