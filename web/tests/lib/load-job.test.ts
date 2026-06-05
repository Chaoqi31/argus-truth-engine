import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getFindingAuditability } from "@/lib/auditability";
import { getBenchmarkEvaluation } from "@/lib/benchmark-evaluation";
import { loadJobFromJsonString, loadSampleJob } from "@/lib/load-job";

describe("load-job", () => {
  it("loadSampleJob returns the bundled demo job", async () => {
    const job = await loadSampleJob();
    expect(job.id).toBeTruthy();
    expect(job.findings.length).toBeGreaterThan(0);
  });

  it("uses finance as the bundled investment demo domain", async () => {
    const job = await loadSampleJob();
    expect(job.content_domain).toBe("finance");
  });

  it("uses legal as the bundled legal demo domain", () => {
    const raw = readFileSync(resolve(process.cwd(), "public/sample-findings-legal.json"), "utf8");
    const job = loadJobFromJsonString(raw);
    expect(job.content_domain).toBe("legal");
  });

  it("loadSampleJob can load the legal scenario", async () => {
    const job = await loadSampleJob("legal");
    expect(job.content_domain).toBe("legal");
    expect(job.persona).toMatch(/legal/i);
  });

  it("legal demo surfaces a real skeptic review; finance demo's high-confidence findings trigger none", async () => {
    const financeJob = await loadSampleJob();
    const legalJob = await loadSampleJob("legal");

    // Skeptic only re-challenges low-confidence high-risk verdicts. The legal
    // demo has one (the Rivera citation, conf 0.75); every finance finding is
    // high-confidence, so the pass correctly fires zero times.
    expect(legalJob.findings.some((finding) => finding.skeptic_review)).toBe(true);
    expect(financeJob.findings.some((finding) => finding.skeptic_review)).toBe(false);
  });

  it("bundled demos include the skeptic pipeline stage", async () => {
    const financeJob = await loadSampleJob();
    const legalJob = await loadSampleJob("legal");

    expect(financeJob.stages?.some((stage) => stage.key === "skeptic")).toBe(true);
    expect(legalJob.stages?.some((stage) => stage.key === "skeptic")).toBe(true);
  });

  it("the legal demo's skeptic finding links a present skeptic control and a real trace", async () => {
    const legalJob = await loadSampleJob("legal");
    const legalFinding = legalJob.findings.find((finding) => finding.skeptic_review);

    expect(legalFinding).toBeTruthy();

    const legalAuditability = getFindingAuditability(legalJob, legalFinding!);
    expect(legalAuditability.controls.find((control) => control.id === "skeptic")?.status).toBe("present");

    const skepticTrace = legalJob.traces.find((trace) => trace.agent === "Skeptic");
    expect(skepticTrace?.steps.length ?? 0).toBeGreaterThan(0);
  });

  it("bundled demos include ground-truth benchmark labels and pass them", async () => {
    const financeJob = await loadSampleJob();
    const legalJob = await loadSampleJob("legal");
    const financeEval = getBenchmarkEvaluation(financeJob);
    const legalEval = getBenchmarkEvaluation(legalJob);

    expect(financeEval).not.toBeNull();
    expect(legalEval).not.toBeNull();
    expect(financeEval?.exactMatches).toBe(financeEval?.total);
    expect(legalEval?.exactMatches).toBe(legalEval?.total);
    expect(financeEval?.issueRecall).toBe(1);
    expect(legalEval?.issueRecall).toBe(1);
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
