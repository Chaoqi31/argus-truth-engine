import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthButton } from "@/components/auth-button";
import { useAuthSession, type AuthSessionState } from "@/lib/use-auth-session";

vi.mock("@/lib/use-auth-session", () => ({
  useAuthSession: vi.fn(),
}));

const signIn = vi.fn(async () => undefined);
const signOut = vi.fn(async () => undefined);
const mockedUseAuthSession = vi.mocked(useAuthSession);

function mockAuth(overrides: Partial<AuthSessionState>) {
  mockedUseAuthSession.mockReturnValue({
    configured: true,
    loading: false,
    accessToken: null,
    user: null,
    signIn,
    signOut,
    ...overrides,
  });
}

describe("AuthButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts Google sign-in with the requested return path", () => {
    mockAuth({ user: null });

    render(<AuthButton next="/audit" />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(signIn).toHaveBeenCalledWith("/audit");
  });

  it("keeps an obvious personal center entry visible after login", () => {
    mockAuth({
      accessToken: "token",
      user: {
        email: "ada@example.com",
        user_metadata: { full_name: "Ada Lovelace" },
      } as AuthSessionState["user"],
    });

    render(<AuthButton next="/audit" />);

    expect(screen.getByRole("link", { name: /personal center/i })).toHaveAttribute(
      "href",
      "/app",
    );
    expect(screen.getByRole("button", { name: /account menu for ada lovelace/i }))
      .toHaveTextContent(/signed in/i);
  });

  it("opens account actions for audit history and sign out", async () => {
    mockAuth({
      accessToken: "token",
      user: {
        email: "ada@example.com",
        user_metadata: { full_name: "Ada Lovelace" },
      } as AuthSessionState["user"],
    });

    render(<AuthButton next="/audit" />);

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.getByRole("menuitem", { name: /audit history/i })).toHaveAttribute(
      "href",
      "/app#history",
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });
});
