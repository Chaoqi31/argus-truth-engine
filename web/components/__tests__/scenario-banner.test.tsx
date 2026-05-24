import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ScenarioBanner } from "../scenario-banner";

describe("ScenarioBanner", () => {
  it("renders the scenario label and persona", () => {
    render(<ScenarioBanner label="Compliance officer scenario." persona="AI governance" />);
    expect(screen.getByText("Compliance officer scenario.")).toBeInTheDocument();
    expect(screen.getByText("AI governance")).toBeInTheDocument();
  });

  it("hides itself when the user clicks Dismiss", () => {
    render(<ScenarioBanner label="L" persona="P" />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("L")).not.toBeInTheDocument();
  });
});
