import { beforeEach, describe, expect, it } from "vitest";
import { useArgusStore } from "@/lib/store";
import type { Job } from "@/lib/types";
import { makeClaim, makeFinding, makeJob, makeStage } from "@/tests/factories";

const minimalJob: Job = makeJob({
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: null,
  cost_usd: 0,
  total_tokens: 0,
  audit_report_md: null,
  claims: [],
  findings: [
    makeFinding({
      id: "f1",
      claim_id: "c1",
      agent: "verifier",
      verdict: "fabricated",
      severity: "major",
      confidence: 0.9,
      summary: "x",
      evidence_ids: [],
      reasoning_trace_id: "t1",
      created_at: "2026-05-20T00:00:00Z",
    }),
  ],
  traces: [],
  evidences: [],
});

const REVIEW_STORAGE_KEY = "argus:finding-reviews:j1";

beforeEach(() => {
  window.localStorage.removeItem(REVIEW_STORAGE_KEY);
  useArgusStore.getState().clear();
});

describe("argus store", () => {
  it("setJob populates job and selects the first finding by default", () => {
    useArgusStore.getState().setJob(minimalJob);
    const s = useArgusStore.getState();
    expect(s.job?.id).toBe("j1");
    expect(s.activeFindingId).toBe("f1");
  });

  it("setJob spotlights an evidence-backed issue before a same-severity source-less finding", () => {
    useArgusStore.getState().setJob({
      ...minimalJob,
      findings: [
        makeFinding({
          id: "f_derived",
          claim_id: "c1",
          agent: "consistency",
          verdict: "contradiction",
          severity: "major",
          confidence: 1,
          summary: "Two claims contradict each other.",
          evidence_ids: [],
          reasoning_trace_id: "t0",
          created_at: "2026-05-20T00:00:00Z",
        }),
        makeFinding({
          id: "f_evidence",
          claim_id: "c1",
          agent: "verifier",
          verdict: "fabricated",
          severity: "major",
          confidence: 0.93,
          summary: "No record was found in primary sources.",
          evidence_ids: ["e1"],
          reasoning_trace_id: "t1",
          created_at: "2026-05-20T00:00:00Z",
        }),
      ],
    });

    expect(useArgusStore.getState().activeFindingId).toBe("f_evidence");
  });

  it("setActiveFinding switches the current finding", () => {
    useArgusStore.getState().setJob(minimalJob);
    useArgusStore.getState().setActiveFinding("f2");
    expect(useArgusStore.getState().activeFindingId).toBe("f2");
  });

  it("clear resets to initial state", () => {
    useArgusStore.getState().setJob(minimalJob);
    useArgusStore.getState().setFindingReview("j1", "f1", { status: "accepted" });
    useArgusStore.getState().clear();
    expect(useArgusStore.getState().job).toBeNull();
    expect(useArgusStore.getState().activeFindingId).toBeNull();
    expect(useArgusStore.getState().findingReviews).toEqual({});
  });

  it("persists reviewer decisions per job", () => {
    const s = useArgusStore.getState();
    s.setJob(minimalJob);
    s.setFindingReview("j1", "f1", {
      status: "disputed",
      note: "Needs a second source.",
    });

    expect(useArgusStore.getState().findingReviews.f1?.status).toBe("disputed");
    expect(useArgusStore.getState().findingReviews.f1?.note).toBe("Needs a second source.");

    useArgusStore.getState().clear();
    useArgusStore.getState().setJob(minimalJob);

    expect(useArgusStore.getState().findingReviews.f1?.status).toBe("disputed");
    expect(useArgusStore.getState().findingReviews.f1?.note).toBe("Needs a second source.");
  });
});

describe("the live job", () => {
  beforeEach(() => {
    useArgusStore.getState().clear();
  });

  it("starts idle", () => {
    const s = useArgusStore.getState();
    expect(s.runStatus).toBe("idle");
    expect(s.runError).toBeNull();
  });

  it("takes the run status from the job it is given", () => {
    useArgusStore.getState().applyJob(makeJob({ status: "running" }));
    expect(useArgusStore.getState().runStatus).toBe("running");

    useArgusStore.getState().applyJob(
      makeJob({ status: "running", stages: [makeStage({ key: "verify", status: "running" })] }),
    );
    expect(useArgusStore.getState().runStatus).toBe("verifying");

    useArgusStore.getState().applyJob(makeJob({ status: "done" }));
    expect(useArgusStore.getState().runStatus).toBe("done");
  });

  it("a job paused for review starts with every candidate selected", () => {
    useArgusStore.getState().applyJob(
      makeJob({
        status: "awaiting_review",
        claims: [makeClaim({ id: "c1" }), makeClaim({ id: "c2", importance: "low" })],
      }),
    );

    const s = useArgusStore.getState();
    expect(s.runStatus).toBe("reviewing");
    expect([...s.selectedClaimIds]).toEqual(["c1", "c2"]);
  });

  it("the reviewer narrows the selection, and later frames keep it", () => {
    useArgusStore.getState().applyJob(
      makeJob({
        status: "awaiting_review",
        claims: [makeClaim({ id: "c1", importance: "high" }), makeClaim({ id: "c2" })],
      }),
    );
    useArgusStore.getState().selectHighImportanceClaims();
    expect([...useArgusStore.getState().selectedClaimIds]).toEqual(["c1"]);

    useArgusStore.getState().applyJob(
      makeJob({ status: "awaiting_review", claims: [makeClaim({ id: "c1" })] }),
    );
    expect([...useArgusStore.getState().selectedClaimIds]).toEqual(["c1"]);
  });

  it("setRunStatus stores error when failed", () => {
    useArgusStore.getState().setRunStatus("failed", "BudgetExceeded");
    expect(useArgusStore.getState().runStatus).toBe("failed");
    expect(useArgusStore.getState().runError).toBe("BudgetExceeded");
  });

  it("clear wipes the job, the run state and the selection", () => {
    const s = useArgusStore.getState();
    s.applyJob(makeJob({ status: "running" }));
    s.clear();

    const cleared = useArgusStore.getState();
    expect(cleared.job).toBeNull();
    expect(cleared.runStatus).toBe("idle");
    expect(cleared.selectedClaimIds.size).toBe(0);
  });
});
