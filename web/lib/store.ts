"use client";

import { create } from "zustand";
import { pickInitialFindingId } from "@/lib/findings";
import type { FindingReview, Job, ReviewerStatus, RunStatus } from "@/lib/types";

function statusFor(job: Job): RunStatus {
  if (job.status === "done") return "done";
  if (job.status === "failed") return "failed";
  if (job.status === "awaiting_review") return "reviewing";
  if (job.stages.some((s) => s.key === "verify" && s.status === "running")) return "verifying";
  return "running";
}

interface ArgusState {
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

  // The live job: a snapshot, then every event applied to it.
  runStatus: RunStatus;
  runError: string | null;
  setRunStatus: (status: RunStatus, error?: string | null) => void;
  /** The job as it now stands: a snapshot, or one folded frame. */
  applyJob: (job: Job) => void;

  // HITL review: the candidates come from the job, the selection is the user's.
  selectedClaimIds: Set<string>;
  toggleClaimSelection: (claimId: string) => void;
  selectAllClaims: () => void;
  selectHighImportanceClaims: () => void;

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
  runStatus: "idle" as RunStatus,
  runError: null as string | null,
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

/** The job, plus the state that follows from it: where the run is, and the
 * review selection (every candidate, until the user narrows it). */
function jobSlice(state: ArgusState, job: Job) {
  return {
    job,
    runStatus: statusFor(job),
    selectedClaimIds:
      job.status === "awaiting_review" && state.selectedClaimIds.size === 0
        ? new Set(job.claims.map((c) => c.id))
        : state.selectedClaimIds,
  };
}

export const useArgusStore = create<ArgusState>((set) => ({
  job: null,
  activeFindingId: null,
  findingReviews: {},
  ...INITIAL_LIVE,
  selectedClaimIds: new Set<string>(),
  ...INITIAL_COCKPIT,

  setJob: (job) =>
    set((s) => ({
      ...jobSlice(s, job),
      activeFindingId: pickInitialFindingId(job.findings),
      findingReviews: readStoredReviews(job.id),
    })),
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
      selectedClaimIds: new Set<string>(),
      ...INITIAL_COCKPIT,
    }),

  setRunStatus: (status, error = null) => set({ runStatus: status, runError: error }),
  applyJob: (job) => set((s) => jobSlice(s, job)),

  toggleClaimSelection: (claimId) =>
    set((s) => {
      const next = new Set(s.selectedClaimIds);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return { selectedClaimIds: next };
    }),
  selectAllClaims: () =>
    set((s) => ({
      selectedClaimIds: new Set((s.job?.claims ?? []).map((c) => c.id)),
    })),
  selectHighImportanceClaims: () =>
    set((s) => ({
      selectedClaimIds: new Set(
        (s.job?.claims ?? []).filter((c) => c.importance === "high").map((c) => c.id),
      ),
    })),

  // cockpit surfaces
  setDrawerFinding: (id) => set({ drawerFindingId: id }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setEvidenceDiff: (target) => set({ evidenceDiff: target }),
  setHighlightedStep: (id) => set({ highlightedStepId: id }),
  setConsoleMode: (mode) => set({ consoleMode: mode }),
  jumpToStep: (stepId) => set({ highlightedStepId: stepId, consoleMode: "trace" }),
}));
