"use client";

import { create } from "zustand";
import type { Job } from "@/lib/types";

export type ReplayState = "idle" | "playing" | "done";

interface ArgusState {
  job: Job | null;
  activeFindingId: string | null;
  replayState: ReplayState;
  setJob: (job: Job) => void;
  setActiveFinding: (findingId: string | null) => void;
  setReplayState: (state: ReplayState) => void;
  clear: () => void;
}

export const useArgusStore = create<ArgusState>((set) => ({
  job: null,
  activeFindingId: null,
  replayState: "idle",
  setJob: (job) =>
    set({
      job,
      activeFindingId: job.findings[0]?.id ?? null,
      replayState: "idle",
    }),
  setActiveFinding: (findingId) => set({ activeFindingId: findingId }),
  setReplayState: (state) => set({ replayState: state }),
  clear: () => set({ job: null, activeFindingId: null, replayState: "idle" }),
}));
