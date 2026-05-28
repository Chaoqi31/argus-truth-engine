"use client";

import { create } from "zustand";
import type {
  FilteredClaim,
  Job,
  LiveFinding,
  ReviewClaim,
  RunStatus,
  Step,
} from "@/lib/types";

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

  // HITL review
  reviewClaims: ReviewClaim[];
  filteredClaims: FilteredClaim[];
  selectedClaimIds: Set<string>;
  setReviewReady: (claims: ReviewClaim[], filtered: FilteredClaim[]) => void;
  toggleClaimSelection: (claimId: string) => void;
  selectAllClaims: () => void;
  clearReview: () => void;

  // cockpit surfaces (T1 contract; filled by T2–T4 surface agents)
  drawerFindingId: string | null;
  replayOpen: boolean;
  replayFindingId: string | null;
  paletteOpen: boolean;
  evidenceDiff: EvidenceDiffTarget | null;
  setDrawerFinding: (id: string | null) => void;
  setReplayOpen: (open: boolean, findingId?: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setEvidenceDiff: (target: EvidenceDiffTarget | null) => void;
}

/** Identifies which finding+evidence pair the evidence-diff modal compares. */
export interface EvidenceDiffTarget {
  findingId: string;
  evidenceId: string;
}

const INITIAL_LIVE = {
  liveSteps: [] as Step[],
  liveFindings: [] as LiveFinding[],
  runStatus: "idle" as RunStatus,
  runError: null as string | null,
};

const INITIAL_REVIEW = {
  reviewClaims: [] as ReviewClaim[],
  filteredClaims: [] as FilteredClaim[],
  selectedClaimIds: new Set<string>(),
};

const INITIAL_COCKPIT = {
  drawerFindingId: null as string | null,
  replayOpen: false,
  replayFindingId: null as string | null,
  paletteOpen: false,
  evidenceDiff: null as EvidenceDiffTarget | null,
};

export const useArgusStore = create<ArgusState>((set) => ({
  job: null,
  activeFindingId: null,
  replayState: "idle",
  ...INITIAL_LIVE,
  ...INITIAL_REVIEW,
  ...INITIAL_COCKPIT,

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
      ...INITIAL_REVIEW,
      ...INITIAL_COCKPIT,
    }),

  appendLiveStep: (step) =>
    set((s) => ({ liveSteps: [...s.liveSteps, step] })),
  appendLiveFinding: (finding) =>
    set((s) => ({ liveFindings: [...s.liveFindings, finding] })),
  setRunStatus: (status, error = null) => set({ runStatus: status, runError: error }),
  resetLive: () => set({ ...INITIAL_LIVE }),

  // HITL review
  setReviewReady: (claims, filtered) =>
    set({
      reviewClaims: claims,
      filteredClaims: filtered,
      selectedClaimIds: new Set(claims.map((c) => c.id)),
      runStatus: "reviewing",
    }),
  toggleClaimSelection: (claimId) =>
    set((s) => {
      const next = new Set(s.selectedClaimIds);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return { selectedClaimIds: next };
    }),
  selectAllClaims: () =>
    set((s) => ({
      selectedClaimIds: new Set(s.reviewClaims.map((c) => c.id)),
    })),
  clearReview: () => set({ ...INITIAL_REVIEW }),

  // cockpit surfaces
  setDrawerFinding: (id) => set({ drawerFindingId: id }),
  setReplayOpen: (open, findingId) =>
    set((s) => ({
      replayOpen: open,
      replayFindingId: open ? (findingId ?? s.replayFindingId) : null,
    })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setEvidenceDiff: (target) => set({ evidenceDiff: target }),
}));
