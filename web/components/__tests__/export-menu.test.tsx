import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ExportMenu } from "../export-menu";

describe("ExportMenu", () => {
  it("calls onSelect with the chosen format", () => {
    const onSelect = vi.fn();
    render(<ExportMenu onSelect={onSelect} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /pdf/i }));
    expect(onSelect).toHaveBeenCalledWith("pdf");
  });

  it("disables the trigger when disabled is true", () => {
    render(<ExportMenu onSelect={() => {}} disabled={true} />);
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });
});
