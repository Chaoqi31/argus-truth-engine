"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadSampleJob, type Scenario } from "@/lib/load-job";
import { applyEvent, emptyJob, type ArgusEvent } from "@/lib/live-job";
import { useArgusStore } from "@/lib/store";
import type { Job, StepType } from "@/lib/types";
import { eventsOf } from "../lib/events";

type DemoReplayParams = {
  liveId: string | null;
  demo: string | null;
  job: Job | null;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  router: AppRouterInstance;
};

/** Per-event delays for the replay; a step keeps the rhythm it streamed at. */
const STEP_DELAY: Record<StepType, number> = {
  thinking: 90,
  message: 250,
  tool_call: 280,
  execute_python: 420,
  execute_command: 420,
  web_search: 550,
  fetch_url_content: 700,
};

const EVENT_DELAY = 180;

function delayFor(event: ArgusEvent): number {
  if (event.type === "step_recorded") return STEP_DELAY[event.step.type] ?? EVENT_DELAY;
  if (event.type === "finished") return 400;
  return EVENT_DELAY;
}

export function useDemoReplay({
  liveId,
  demo,
  job,
  scenario,
  setScenario,
  router,
}: DemoReplayParams) {
  const setRunStatus = useArgusStore((s) => s.setRunStatus);
  const setJob = useArgusStore((s) => s.setJob);
  const applyJob = useArgusStore((s) => s.applyJob);
  const clearStore = useArgusStore((s) => s.clear);

  const [demoJob, setDemoJob] = useState<Job | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopReplay = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopReplay(), [stopReplay]);

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

  useEffect(() => {
    if (liveId || demo || !job) return;
    stopReplay();
    clearStore();
  }, [liveId, demo, job, clearStore, stopReplay]);

  const runDemo = () => {
    if (!demoJob || demoRunning) return;
    stopReplay();
    setDemoRunning(true);

    const events = eventsOf(demoJob);
    let current = emptyJob(demoJob);
    let i = 0;
    setJob(current);
    setRunStatus("running");

    const tick = () => {
      const event = events[i++];
      if (event === undefined) {
        setDemoRunning(false);
        return;
      }
      current = applyEvent(current, event);
      applyJob(current);
      timerRef.current = setTimeout(tick, delayFor(event));
    };
    timerRef.current = setTimeout(tick, 120);
  };

  const replayDemo = () => {
    stopReplay();
    runDemo();
  };

  const finishDemoNow = () => {
    if (!demoJob) return;
    stopReplay();
    setJob(demoJob);
    setDemoRunning(false);
  };

  const startAuditingFromDemo = () => {
    stopReplay();
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
