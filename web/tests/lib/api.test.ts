import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArgusApiError,
  JobNotFoundError,
  UnsupportedMediaTypeError,
  getJob,
  getSharedJob,
  submitClaimSelection,
  uploadPdf,
} from "@/lib/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("uploadPdf", () => {
  it("posts multipart with the file under `pdf` and returns the body", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (url, init) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(JSON.stringify({ job_id: "job_abc", status: "running" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    });

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "x.pdf", {
      type: "application/pdf",
    });
    const out = await uploadPdf(file);

    expect(out).toEqual({ job_id: "job_abc", status: "running" });
    expect(captured.url).toBe("/api/argus/jobs");
    expect(captured.init?.method).toBe("POST");
    expect(captured.init?.body).toBeInstanceOf(FormData);
    const form = captured.init?.body as FormData;
    const fileField = form.get("pdf") as File;
    expect(fileField.name).toBe("x.pdf");
    expect(fileField.type).toBe("application/pdf");
  });

  it("includes content_domain when a PDF domain is selected", async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (_, init) => {
      captured.init = init;
      return new Response(JSON.stringify({ job_id: "job_abc", status: "running" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    });

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "x.pdf", {
      type: "application/pdf",
    });
    await uploadPdf(file, "test-key", { contentDomain: "finance" });

    const form = captured.init?.body as FormData;
    expect(form.get("content_domain")).toBe("finance");
  });

  it("can submit a PDF with auth and a saved API key id", async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (_, init) => {
      captured.init = init;
      return new Response(JSON.stringify({ job_id: "job_abc", status: "running" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    });

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "x.pdf", {
      type: "application/pdf",
    });
    await uploadPdf(file, undefined, { accessToken: "jwt_1", apiKeyId: "key_1" });

    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt_1");
    expect(headers["X-Miromind-Key-Id"]).toBe("key_1");
    expect(headers["X-Miromind-Key"]).toBeUndefined();
  });

  it("throws UnsupportedMediaTypeError on 415", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "expected application/pdf" }), {
          status: 415,
          headers: { "content-type": "application/json" },
        }),
    );

    const file = new File(["x"], "x.txt", { type: "text/plain" });
    await expect(uploadPdf(file)).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
  });

  it("throws ArgusApiError on other non-2xx", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("boom", { status: 500 }),
    );
    const file = new File(["x"], "x.pdf", { type: "application/pdf" });
    await expect(uploadPdf(file)).rejects.toBeInstanceOf(ArgusApiError);
  });
});

describe("submitClaimSelection", () => {
  it("posts selected claim ids and resolves on 200", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (url, init) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(null, { status: 200 });
    });

    await submitClaimSelection("job_abc", ["c1", "c2"]);

    expect(captured.url).toBe("/api/argus/jobs/job_abc/claims/select");
    expect(captured.init?.method).toBe("POST");
    expect(JSON.parse(captured.init?.body as string)).toEqual({
      selected_claim_ids: ["c1", "c2"],
    });
  });

  it("includes X-Miromind-Key header when apiKey is provided", async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (_, init) => {
      captured.init = init;
      return new Response(null, { status: 200 });
    });

    await submitClaimSelection("job_abc", ["c1"], "my-test-key");

    expect((captured.init?.headers as Record<string, string>)["X-Miromind-Key"]).toBe(
      "my-test-key",
    );
  });

  it("omits X-Miromind-Key header when apiKey is null", async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (_, init) => {
      captured.init = init;
      return new Response(null, { status: 200 });
    });

    await submitClaimSelection("job_abc", ["c1"], null);

    expect(
      (captured.init?.headers as Record<string, string>)["X-Miromind-Key"],
    ).toBeUndefined();
  });

  it("throws ArgusApiError on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () => new Response("err", { status: 500 }));
    await expect(submitClaimSelection("job_abc", [])).rejects.toBeInstanceOf(ArgusApiError);
  });
});

describe("getJob", () => {
  it("returns the parsed Job on 200", async () => {
    const body = { id: "job_abc", pdf_path: "/u/x.pdf", status: "done", findings: [] };
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const out = await getJob("job_abc");
    expect(out.id).toBe("job_abc");
  });

  it("throws JobNotFoundError on 404", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 }));
    await expect(getJob("nope")).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it("includes Authorization when loading an authenticated job", async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (_, init) => {
      captured.init = init;
      return new Response(
        JSON.stringify({ id: "job_abc", pdf_path: "", status: "done", findings: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await getJob("job_abc", { accessToken: "jwt_1" });

    expect((captured.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer jwt_1",
    );
  });
});

describe("getSharedJob", () => {
  it("loads a public shared audit by token", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (url, init) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(
        JSON.stringify({ id: "job_shared", pdf_path: "", status: "done", findings: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const out = await getSharedJob("token_1");

    expect(out.id).toBe("job_shared");
    expect(captured.url).toBe("/api/argus/share/token_1");
    expect((captured.init?.headers as Record<string, string> | undefined)?.Authorization)
      .toBeUndefined();
  });

  it("throws JobNotFoundError for missing share links", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 }));
    await expect(getSharedJob("missing")).rejects.toBeInstanceOf(JobNotFoundError);
  });
});
