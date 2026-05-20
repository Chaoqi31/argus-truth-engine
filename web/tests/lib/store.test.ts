import { beforeEach, describe, expect, it } from "vitest";
import { useArgusStore } from "@/lib/store";
import type { Job } from "@/lib/types";

const minimalJob: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: null,
  cost_usd: 0,
  total_tokens: 0,
  claims: [],
  findings: [
    {
      id: "f1",
      job_id: "j1",
      claim_id: "c1",
      agent: "CitationVerifier",
      verdict: "fabricated",
      severity: "major",
      confidence: 0.9,
      summary: "x",
      evidence_ids: [],
      reasoning_trace_id: "t1",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
  ],
  traces: [],
  evidences: [],
};

beforeEach(() => {
  useArgusStore.setState({ job: null, activeFindingId: null, replayState: "idle" });
});

describe("argus store", () => {
  it("setJob populates job and selects the first finding by default", () => {
    useArgusStore.getState().setJob(minimalJob);
    const s = useArgusStore.getState();
    expect(s.job?.id).toBe("j1");
    expect(s.activeFindingId).toBe("f1");
  });

  it("setActiveFinding switches the current finding", () => {
    useArgusStore.getState().setJob(minimalJob);
    useArgusStore.getState().setActiveFinding("f2");
    expect(useArgusStore.getState().activeFindingId).toBe("f2");
  });

  it("clear resets to initial state", () => {
    useArgusStore.getState().setJob(minimalJob);
    useArgusStore.getState().clear();
    expect(useArgusStore.getState().job).toBeNull();
    expect(useArgusStore.getState().activeFindingId).toBeNull();
  });
});
