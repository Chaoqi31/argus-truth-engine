import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountApiError,
  buildShareUrl,
  createAuditShareLink,
  deleteAccountData,
  deleteAuditJob,
  recordEvent,
  rerunAuditJob,
  revokeAuditShareLink,
  testSavedApiKey,
  updateSavedApiKey,
} from "@/lib/account";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("account API helpers", () => {
  it("renames a saved API key and can make it default", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (url, init) => {
      captured.url = String(url);
      captured.init = init;
      return jsonResponse({
        id: "key_1",
        provider: "miromind",
        label: "Production",
        fingerprint: "fp",
        last4: "1234",
        is_default: true,
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
      });
    });

    const out = await updateSavedApiKey("jwt_1", "key_1", {
      label: "Production",
      makeDefault: true,
    });

    expect(out.label).toBe("Production");
    expect(captured.url).toBe("/api/argus/me/api-keys/key_1");
    expect(captured.init?.method).toBe("PATCH");
    expect(captured.init?.headers).toMatchObject({
      Authorization: "Bearer jwt_1",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(captured.init?.body as string)).toEqual({
      label: "Production",
      make_default: true,
    });
  });

  it("tests an existing saved API key by id", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (url, init) => {
      captured.url = String(url);
      captured.init = init;
      return jsonResponse({ ok: true, message: "ok", response_id: "resp_1" });
    });

    const out = await testSavedApiKey("jwt_1", { keyId: "key_1" });

    expect(out.ok).toBe(true);
    expect(captured.url).toBe("/api/argus/me/api-keys/test");
    expect(JSON.parse(captured.init?.body as string)).toEqual({
      key_id: "key_1",
    });
  });

  it("creates, revokes, deletes, and reruns audit records with auth", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/share")) {
        return jsonResponse(
          {
            token: "share_1",
            job_id: "job_1",
            created_at: "2026-01-01T00:00:00Z",
            expires_at: null,
          },
          201,
        );
      }
      if (String(url).endsWith("/rerun")) {
        return jsonResponse({ job_id: "job_2", status: "running" }, 202);
      }
      return new Response(null, { status: 204 });
    });

    await createAuditShareLink("jwt_1", "job_1", 14);
    await revokeAuditShareLink("jwt_1", "job_1", "share_1");
    await deleteAuditJob("jwt_1", "job_1");
    const rerun = await rerunAuditJob("jwt_1", "job_1");

    expect(rerun.job_id).toBe("job_2");
    expect(calls.map((call) => call.url)).toEqual([
      "/api/argus/jobs/job_1/share",
      "/api/argus/jobs/job_1/share/share_1",
      "/api/argus/jobs/job_1",
      "/api/argus/jobs/job_1/rerun",
    ]);
    expect(calls.every((call) => hasBearer(call.init))).toBe(true);
  });

  it("records product events without requiring auth", async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (_, init) => {
      captured.init = init;
      return new Response(null, { status: 202 });
    });

    await recordEvent(null, "workspace_viewed", {
      path: "/app",
      properties: { signed_in: false },
    });

    expect(captured.init?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(captured.init?.body as string)).toEqual({
      event_name: "workspace_viewed",
      path: "/app",
      properties: { signed_in: false },
      auth_required: false,
    });
  });

  it("throws status-aware errors for expired sessions", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "login required" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(deleteAccountData("jwt_1")).rejects.toMatchObject<AccountApiError>({
      status: 401,
      message: "login required",
    });
  });

  it("builds stable share URLs in the browser", () => {
    expect(buildShareUrl("abc")).toBe("http://localhost:3000/share/abc");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hasBearer(init?: RequestInit): boolean {
  return (init?.headers as Record<string, string> | undefined)?.Authorization === "Bearer jwt_1";
}
