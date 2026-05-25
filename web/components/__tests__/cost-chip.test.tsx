import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CostChip } from "../cost-chip";

describe("CostChip", () => {
  it("renders the cost in dollars with a comparator hint", () => {
    render(<CostChip costUsd={2.74} />);
    expect(screen.getByText(/\$2\.74/)).toBeInTheDocument();
    expect(screen.getByText(/vs ~\$70 manual/i)).toBeInTheDocument();
  });

  it("hides when costUsd is null", () => {
    const { container } = render(<CostChip costUsd={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
