"use client";

import { create } from "zustand";
import { pickInitialFindingId } from "@/lib/findings";
import type {
  FilteredClaim,
  FindingReview,
  Job,
  LiveHeartbeat,
  LiveFinding,
  ReviewClaim,
  ReviewerStatus,
  RunStatus,
  Step,
} from "@/lib/types";

interface ArgusState {
  // existing
  job: Job | null;
  activeFindingId: string | null;
  findingReviews: Record<string, FindingReview>;
  setJob: (job: Job) => void;
  setActiveFinding: (findingId: string | null) => void;
  setFindingReview: (
    jobId: string,
    findingId: string,
    patch: Partial<Pick<FindingReview, "status" | "note">>,
  ) => void;
  clear: () => void;

  // live-mode (B3-C)
  liveSteps: Step[];
  liveFindings: LiveFinding[];
  liveHeartbeat: LiveHeartbeat | null;
  runStatus: RunStatus;
  runError: string | null;
  appendLiveStep: (step: Step) => void;
  appendLiveSteps: (steps: Step[]) => void;
  appendLiveFinding: (finding: LiveFinding) => void;
  setLiveHeartbeat: (heartbeat: LiveHeartbeat | null) => void;
  setRunStatus: (status: RunStatus, error?: string | null) => void;
  resetLive: () => void;

  // HITL review
  reviewClaims: ReviewClaim[];
  filteredClaims: FilteredClaim[];
  selectedClaimIds: Set<string>;
  setReviewReady: (claims: ReviewClaim[], filtered: FilteredClaim[]) => void;
  toggleClaimSelection: (claimId: string) => void;
  selectAllClaims: () => void;
  selectHighImportanceClaims: () => void;
  clearReview: () => void;

  // cockpit surfaces (T1 contract; filled by T2–T4 surface agents)
  drawerFindingId: string | null;
  paletteOpen: boolean;
  evidenceDiff: EvidenceDiffTarget | null;
  highlightedStepId: string | null;
  consoleMode: ConsoleMode;
  setDrawerFinding: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setEvidenceDiff: (target: EvidenceDiffTarget | null) => void;
  setHighlightedStep: (id: string | null) => void;
  setConsoleMode: (mode: ConsoleMode) => void;
  jumpToStep: (stepId: string) => void;
}

export type ConsoleMode = "evidence" | "trace";

/** Identifies which finding+evidence pair the evidence-diff modal compares. */
export interface EvidenceDiffTarget {
  findingId: string;
  evidenceId: string;
}

const INITIAL_LIVE = {
  liveSteps: [] as Step[],
  liveFindings: [] as LiveFinding[],
  liveHeartbeat: null as LiveHeartbeat | null,
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
  paletteOpen: false,
  evidenceDiff: null as EvidenceDiffTarget | null,
  highlightedStepId: null as string | null,
  consoleMode: "evidence" as ConsoleMode,
};

const DEFAULT_REVIEW_STATUS: ReviewerStatus = "open";

function reviewStorageKey(jobId: string): string {
  return `argus:finding-reviews:${jobId}`;
}

function readStoredReviews(jobId: string): Record<string, FindingReview> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(reviewStorageKey(jobId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, FindingReview>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeStoredReviews(jobId: string, reviews: Record<string, FindingReview>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(reviewStorageKey(jobId), JSON.stringify(reviews));
  } catch {
    /* local persistence is best-effort */
  }
}

export const useArgusStore = create<ArgusState>((set) => ({
  job: null,
  activeFindingId: null,
  findingReviews: {},
  ...INITIAL_LIVE,
  ...INITIAL_REVIEW,
  ...INITIAL_COCKPIT,

  setJob: (job) =>
    set({
      job,
      activeFindingId: pickInitialFindingId(job.findings),
      findingReviews: readStoredReviews(job.id),
    }),
  setActiveFinding: (findingId) => set({ activeFindingId: findingId }),
  setFindingReview: (jobId, findingId, patch) =>
    set((s) => {
      const prev = s.findingReviews[findingId] ?? {
        status: DEFAULT_REVIEW_STATUS,
        note: "",
        updated_at: new Date().toISOString(),
      };
      const next = {
        ...s.findingReviews,
        [findingId]: {
          ...prev,
          ...patch,
          updated_at: new Date().toISOString(),
        },
      };
      writeStoredReviews(jobId, next);
      return { findingReviews: next };
    }),
  clear: () =>
    set({
      job: null,
      activeFindingId: null,
      findingReviews: {},
      ...INITIAL_LIVE,
      ...INITIAL_REVIEW,
      ...INITIAL_COCKPIT,
    }),

  appendLiveStep: (step) =>
    set((s) => ({ liveSteps: [...s.liveSteps, step] })),
  appendLiveSteps: (steps) => {
    if (steps.length === 0) return;
    set((s) => ({ liveSteps: [...s.liveSteps, ...steps] }));
  },
  appendLiveFinding: (finding) =>
    set((s) => {
      const existing = s.liveFindings.findIndex((f) => f.id === finding.id);
      if (existing === -1) return { liveFindings: [...s.liveFindings, finding] };
      const next = [...s.liveFindings];
      next[existing] = finding;
      return { liveFindings: next };
    }),
  setLiveHeartbeat: (heartbeat) => set({ liveHeartbeat: heartbeat }),
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
  selectHighImportanceClaims: () =>
    set((s) => ({
      selectedClaimIds: new Set(
        s.reviewClaims.filter((c) => c.importance === "high").map((c) => c.id),
      ),
    })),
  clearReview: () => set({ ...INITIAL_REVIEW }),

  // cockpit surfaces
  setDrawerFinding: (id) => set({ drawerFindingId: id }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setEvidenceDiff: (target) => set({ evidenceDiff: target }),
  setHighlightedStep: (id) => set({ highlightedStepId: id }),
  setConsoleMode: (mode) => set({ consoleMode: mode }),
  jumpToStep: (stepId) => set({ highlightedStepId: stepId, consoleMode: "trace" }),
}));
