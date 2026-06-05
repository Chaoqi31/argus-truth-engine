import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DemoRunControls } from "@/components/demo-run-controls";

describe("DemoRunControls", () => {
  it("lets a judge skip the replay and open the full completed audit", () => {
    const onShowFullAudit = vi.fn();

    render(<DemoRunControls onShowFullAudit={onShowFullAudit} />);
    fireEvent.click(screen.getByRole("button", { name: /show full audit/i }));

    expect(onShowFullAudit).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/skip replay/i)).toBeInTheDocument();
  });

  it("does not trigger the action while disabled", () => {
    const onShowFullAudit = vi.fn();

    render(<DemoRunControls onShowFullAudit={onShowFullAudit} disabled />);
    const button = screen.getByRole("button", { name: /show full audit/i });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onShowFullAudit).not.toHaveBeenCalled();
  });
});
