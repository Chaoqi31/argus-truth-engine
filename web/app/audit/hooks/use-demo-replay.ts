import { useEffect, useRef, useState } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadSampleJob, type Scenario } from "@/lib/load-job";
import { replayTrace } from "@/lib/trace-replayer";
import { orderFindingsForDemoReplay } from "@/lib/demo-replay";
import { useArgusStore } from "@/lib/store";
import type { Job, Step } from "@/lib/types";
import { toLiveFinding } from "../lib/trace-payload";

type DemoReplayParams = {
  liveId: string | null;
  demo: string | null;
  job: Job | null;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  router: AppRouterInstance;
};

export function useDemoReplay({
  liveId,
  demo,
  job,
  scenario,
  setScenario,
  router,
}: DemoReplayParams) {
  const resetLive = useArgusStore((s) => s.resetLive);
  const setRunStatus = useArgusStore((s) => s.setRunStatus);
  const setJob = useArgusStore((s) => s.setJob);
  const appendLiveStep = useArgusStore((s) => s.appendLiveStep);
  const appendLiveFinding = useArgusStore((s) => s.appendLiveFinding);
  const setConsoleMode = useArgusStore((s) => s.setConsoleMode);
  const clearStore = useArgusStore((s) => s.clear);

  const [demoJob, setDemoJob] = useState<Job | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const demoAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (liveId) return;
    if (job) return;
    if (!demo) return;
    let cancelled = false;
    loadSampleJob(scenario)
      .then((sample) => {
        if (!cancelled) setDemoJob(sample);
      })
      .catch((err: unknown) => {
        console.error("loadSampleJob failed", err);
        if (!cancelled) router.replace("/");
      });
    return () => {
      cancelled = true;
    };
  }, [scenario, liveId, demo, job, router]);

  useEffect(() => () => demoAbortRef.current?.abort(), []);

  useEffect(() => {
    if (liveId || demo || !job) return;
    demoAbortRef.current?.abort();
    clearStore();
  }, [liveId, demo, job, clearStore]);

  const runDemo = () => {
    if (!demoJob || demoRunning) return;
    demoAbortRef.current?.abort();
    const controller = new AbortController();
    demoAbortRef.current = controller;
    const { signal } = controller;

    resetLive();
    setRunStatus("running");
    setDemoRunning(true);

    const findings = orderFindingsForDemoReplay(demoJob);
    const claimText = new Map(demoJob.claims.map((c) => [c.id, c.text]));
    const traceById = new Map(demoJob.traces.map((t) => [t.id, t]));
    const stagesByKey = new Map((demoJob.stages ?? []).map((s) => [s.key, s]));
    const findingIndex = new Map(findings.map((f, k) => [f.id, k] as const));

    let seq = 0;
    const timeline: Step[] = [];
    const revealAt = new Array<number>(findings.length).fill(0);
    const marker = (content: Record<string, unknown>, summary: string): Step => ({
      id: `pipe-${seq}`,
      trace_id: "__pipeline",
      sequence: ++seq,
      type: "message",
      summary,
      content,
      evidence_ids: [],
      parent_step_id: null,
      created_at: "",
    });
    const pushStage = (key: string) => {
      const st = stagesByKey.get(key);
      if (!st) return;
      timeline.push(
        marker(
          { __stage: { key: st.key, name: st.name, engine: st.engine, summary: st.summary } },
          st.summary,
        ),
      );
    };

    (["parse", "planner", "atomizer", "checkworthiness", "review_gate"] as const).forEach(pushStage);

    const verifiers = findings.filter((f) => f.agent === "UnifiedVerifier");
    verifiers.forEach((f, i) => {
      const trace = traceById.get(f.reasoning_trace_id);
      const tsteps = trace ? [...trace.steps].sort((a, b) => a.sequence - b.sequence) : [];
      if (tsteps.length === 0) return;
      const text = claimText.get(f.claim_id) ?? f.summary;
      timeline.push(marker({ __claim: { index: i + 1, total: verifiers.length, text } }, text));
      tsteps.forEach((s) => timeline.push({ ...s, sequence: ++seq }));
      const k = findingIndex.get(f.id);
      if (k !== undefined) revealAt[k] = timeline.length;
    });

    (["consistency", "confidence", "reporter"] as const).forEach((key) => {
      pushStage(key);
      if (key === "consistency") {
        findings
          .filter((f) => f.agent === "Consistency")
          .forEach((f) => {
            const k = findingIndex.get(f.id);
            if (k !== undefined) revealAt[k] = timeline.length;
          });
      }
    });

    const revealed = new Set<number>();
    let shown = 0;

    void replayTrace(
      timeline,
      (step) => {
        appendLiveStep(step);
        shown += 1;
        findings.forEach((f, k) => {
          if (!revealed.has(k) && revealAt[k] > 0 && shown >= revealAt[k]) {
            appendLiveFinding(toLiveFinding(f));
            revealed.add(k);
          }
        });
      },
      { signal },
    ).then(() => {
      if (signal.aborted) return;
      findings.forEach((f, k) => {
        if (!revealed.has(k)) appendLiveFinding(toLiveFinding(f));
      });
      setJob(demoJob);
      setRunStatus("done");
      setConsoleMode("evidence");
      setDemoRunning(false);
    });
  };

  const replayDemo = () => {
    clearStore();
    runDemo();
  };

  const finishDemoNow = () => {
    if (!demoJob) return;
    demoAbortRef.current?.abort();
    setJob(demoJob);
    setRunStatus("done");
    setConsoleMode("evidence");
    setDemoRunning(false);
  };

  const startAuditingFromDemo = () => {
    demoAbortRef.current?.abort();
    clearStore();
  };

  return {
    demoJob,
    demoRunning,
    runDemo,
    replayDemo,
    finishDemoNow,
    startAuditingFromDemo,
    setScenario,
    scenario,
  };
}
