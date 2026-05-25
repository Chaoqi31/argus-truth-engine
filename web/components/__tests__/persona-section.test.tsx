import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PersonaSection } from "../persona-section";

describe("PersonaSection", () => {
  it("renders three persona cards with scenario copy", () => {
    render(<PersonaSection />);
    expect(screen.getByText(/Legal & compliance/i)).toBeInTheDocument();
    expect(screen.getByText(/AI governance/i)).toBeInTheDocument();
    expect(screen.getByText(/Investment & research/i)).toBeInTheDocument();
    const section = screen.getByRole("region", { name: /who uses argus/i });
    expect(section).toBeInTheDocument();
  });
});
