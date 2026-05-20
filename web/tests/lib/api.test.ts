import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArgusApiError,
  JobNotFoundError,
  UnsupportedMediaTypeError,
  getJob,
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
});
