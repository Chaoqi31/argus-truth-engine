import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppHomePage from "@/app/app/page";
import { useAuthSession, type AuthSessionState } from "@/lib/use-auth-session";
import { listJobSummaries, listSavedApiKeys } from "@/lib/account";

const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams("signedIn=1"),
}));

vi.mock("@/lib/use-auth-session", () => ({
  useAuthSession: vi.fn(),
}));

vi.mock("@/lib/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account")>();
  return {
    ...actual,
    listJobSummaries: vi.fn(),
    listSavedApiKeys: vi.fn(),
    recordEvent: vi.fn(async () => undefined),
  };
});

const mockedUseAuthSession = vi.mocked(useAuthSession);
const mockedListJobSummaries = vi.mocked(listJobSummaries);
const mockedListSavedApiKeys = vi.mocked(listSavedApiKeys);

describe("AppHomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuthSession.mockReturnValue({
      configured: true,
      loading: false,
      accessToken: "jwt_1",
      user: {
        email: "ada@example.com",
        user_metadata: { full_name: "Ada Lovelace" },
      } as AuthSessionState["user"],
      signIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
    });
    mockedListJobSummaries.mockResolvedValue([
      {
        id: "job_1",
        status: "done",
        input_mode: "text",
        title: "Existing audit",
        created_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-01T00:01:00Z",
        findings_count: 2,
        claims_total: 3,
        claims_audited: 3,
        cost_usd: 0.12,
        share_links: [
          {
            token: "share_1",
            job_id: "job_1",
            created_at: "2026-01-01T00:00:00Z",
            expires_at: null,
          },
        ],
      },
    ]);
    mockedListSavedApiKeys.mockResolvedValue([
      {
        id: "key_1",
        provider: "miromind",
        label: "Primary key",
        fingerprint: "fp",
        last4: "1234",
        is_default: true,
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
      },
    ]);
  });

  it("shows the signed-in workspace with history and API key state", async () => {
    render(<AppHomePage />);

    await screen.findByRole("heading", { name: "Ada Lovelace" });
    expect(screen.getAllByText("Signed in").length).toBeGreaterThan(0);
    expect(screen.getByText("Signed in. Your workspace is ready.")).toBeInTheDocument();

    await waitFor(() => expect(mockedListJobSummaries).toHaveBeenCalledWith("jwt_1"));
    expect(screen.getByText("Existing audit")).toBeInTheDocument();
    expect(screen.getByText("Read-only share link active")).toBeInTheDocument();
    expect(screen.getByText("Default: ****1234")).toBeInTheDocument();
    expect(screen.getByText("Primary key")).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/app", { scroll: false });
  });
});
