import { beforeEach, describe, expect, it } from "vitest";
import { useArgusStore } from "@/lib/store";
import type { Job, LiveFinding } from "@/lib/types";

const minimalJob: Job = {
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
    {
      id: "f1",
      job_id: "j1",
      claim_id: "c1",
      agent: "UnifiedVerifier",
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

describe("live-mode state", () => {
  beforeEach(() => {
    useArgusStore.getState().clear();
  });

  it("starts idle with empty live arrays", () => {
    const s = useArgusStore.getState();
    expect(s.runStatus).toBe("idle");
    expect(s.liveSteps).toEqual([]);
    expect(s.liveFindings).toEqual([]);
    expect(s.runError).toBeNull();
  });

  it("appendLiveStep accumulates", () => {
    const step = {
      id: "s1",
      trace_id: "t1",
      sequence: 1,
      type: "thinking" as const,
      summary: "...",
      content: {},
      evidence_ids: [],
      parent_step_id: null,
      created_at: "2026-05-21T00:00:00Z",
    };
    useArgusStore.getState().appendLiveStep(step);
    expect(useArgusStore.getState().liveSteps).toHaveLength(1);
  });

  it("appendLiveFinding accumulates", () => {
    const f: LiveFinding = {
      id: "f1",
      claim_id: "c1",
      agent: "UnifiedVerifier",
      verdict: "fabricated",
      severity: "major",
      summary: "No record",
    };
    useArgusStore.getState().appendLiveFinding(f);
    expect(useArgusStore.getState().liveFindings).toEqual([f]);
  });

  it("setRunStatus stores error when failed", () => {
    useArgusStore.getState().setRunStatus("failed", "BudgetExceeded");
    expect(useArgusStore.getState().runStatus).toBe("failed");
    expect(useArgusStore.getState().runError).toBe("BudgetExceeded");
  });

  it("resetLive wipes live arrays + status without touching job", () => {
    const s = useArgusStore.getState();
    s.setJob(minimalJob);
    s.appendLiveStep({
      id: "s1",
      trace_id: "t1",
      sequence: 1,
      type: "thinking",
      summary: "",
      content: {},
      evidence_ids: [],
      parent_step_id: null,
      created_at: "2026-05-21T00:00:00Z",
    });
    s.resetLive();
    expect(useArgusStore.getState().liveSteps).toEqual([]);
    expect(useArgusStore.getState().liveFindings).toEqual([]);
    expect(useArgusStore.getState().runStatus).toBe("idle");
    expect(useArgusStore.getState().job?.id).toBe("j1");
  });
});
