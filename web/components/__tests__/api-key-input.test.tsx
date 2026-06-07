import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyInput } from "@/components/api-key-input";

const STORAGE_KEY = "argus-miromind-key";

describe("ApiKeyInput", () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  });

  it("does not show low-level transport/storage copy under the key field", () => {
    render(<ApiKeyInput value="" onChange={vi.fn()} />);

    expect(screen.queryByText(/Not stored unless you choose to remember it/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/X-Miromind-Key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/operator of this demo never sees it/i)).not.toBeInTheDocument();
  });

  it("keeps the key for the current browser session by default without local persistence", () => {
    const onChange = vi.fn();
    render(<ApiKeyInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/MiroMind API key/i), {
      target: { value: "test-key" },
    });

    expect(onChange).toHaveBeenCalledWith("test-key");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("test-key");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("persists the key only after explicit local-remember consent", () => {
    render(<ApiKeyInput value="test-key" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /remember key/i }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("test-key");
  });
});
