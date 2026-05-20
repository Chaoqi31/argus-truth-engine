import { describe, expect, it } from "vitest";
import { loadJobFromJsonString, loadSampleJob } from "@/lib/load-job";

describe("load-job", () => {
  it("loadSampleJob returns the bundled demo job", async () => {
    const job = await loadSampleJob();
    expect(job.id).toBe("job_demo_argus");
    expect(job.findings.length).toBeGreaterThan(0);
  });

  it("loadJobFromJsonString parses a valid Job", () => {
    const json = JSON.stringify({
      id: "j1",
      pdf_path: "x.pdf",
      status: "done",
      created_at: "2026-05-20T00:00:00Z",
      completed_at: null,
      cost_usd: 0,
      total_tokens: 0,
      claims: [],
      findings: [],
      traces: [],
      evidences: [],
    });
    const job = loadJobFromJsonString(json);
    expect(job.id).toBe("j1");
  });

  it("loadJobFromJsonString throws on missing required fields", () => {
    expect(() => loadJobFromJsonString('{"id":"x"}')).toThrow(/findings/i);
  });
});
