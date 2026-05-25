import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BenchmarkDisclosure } from "../benchmark-disclosure";

describe("BenchmarkDisclosure", () => {
  it("publishes both recall and the source PDF link", () => {
    render(<BenchmarkDisclosure />);
    expect(screen.getByText(/we publish our recall/i)).toBeInTheDocument();
    expect(screen.getAllByText(/planted errors/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/high-confidence/i)).toBeInTheDocument();
  });
});
