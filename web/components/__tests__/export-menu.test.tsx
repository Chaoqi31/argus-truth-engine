import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ExportMenu } from "../export-menu";

describe("ExportMenu", () => {
  it("calls onSelect with the chosen format", () => {
    const onSelect = vi.fn();
    render(<ExportMenu onSelect={onSelect} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /audit pack/i }));
    expect(onSelect).toHaveBeenCalledWith("audit_pack");
  });

  it("exposes the evidence station JSON export", () => {
    const onSelect = vi.fn();
    render(<ExportMenu onSelect={onSelect} disabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /evidence station/i }));

    expect(onSelect).toHaveBeenCalledWith("json");
  });

  it("disables the trigger when disabled is true", () => {
    render(<ExportMenu onSelect={() => {}} disabled={true} />);
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });

  it("announces expanded state and closes the menu on Escape", () => {
    render(<ExportMenu onSelect={() => {}} disabled={false} />);

    const trigger = screen.getByRole("button", { name: /export/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
