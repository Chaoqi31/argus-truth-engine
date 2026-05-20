"use client";

import { create } from "zustand";
import type { Job, LiveFinding, RunStatus, Step } from "@/lib/types";

export type ReplayState = "idle" | "playing" | "done";

interface ArgusState {
  // existing
  job: Job | null;
  activeFindingId: string | null;
  replayState: ReplayState;
  setJob: (job: Job) => void;
  setActiveFinding: (findingId: string | null) => void;
  setReplayState: (state: ReplayState) => void;
  clear: () => void;

  // live-mode (B3-C)
  liveSteps: Step[];
  liveFindings: LiveFinding[];
  runStatus: RunStatus;
  runError: string | null;
  appendLiveStep: (step: Step) => void;
  appendLiveFinding: (finding: LiveFinding) => void;
  setRunStatus: (status: RunStatus, error?: string | null) => void;
  resetLive: () => void;
}

const INITIAL_LIVE = {
  liveSteps: [] as Step[],
  liveFindings: [] as LiveFinding[],
  runStatus: "idle" as RunStatus,
  runError: null as string | null,
};

export const useArgusStore = create<ArgusState>((set) => ({
  job: null,
  activeFindingId: null,
  replayState: "idle",
  ...INITIAL_LIVE,

  setJob: (job) =>
    set({
      job,
      activeFindingId: job.findings[0]?.id ?? null,
      replayState: "idle",
    }),
  setActiveFinding: (findingId) => set({ activeFindingId: findingId }),
  setReplayState: (state) => set({ replayState: state }),
  clear: () =>
    set({
      job: null,
      activeFindingId: null,
      replayState: "idle",
      ...INITIAL_LIVE,
    }),

  appendLiveStep: (step) =>
    set((s) => ({ liveSteps: [...s.liveSteps, step] })),
  appendLiveFinding: (finding) =>
    set((s) => ({ liveFindings: [...s.liveFindings, finding] })),
  setRunStatus: (status, error = null) => set({ runStatus: status, runError: error }),
  resetLive: () => set({ ...INITIAL_LIVE }),
}));
