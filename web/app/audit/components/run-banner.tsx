"use client";

import type { Job, RunStatus } from "@/lib/types";

export function RunBanner({
  runStatus,
  job,
  reason,
}: {
  runStatus: RunStatus;
  job: Job | null;
  reason: string | null;
}) {
  if (runStatus === "reviewing") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-12 items-center gap-3 border-b border-[var(--cc-warn)]/40 bg-[var(--cc-warn)]/10 px-4 text-xs"
      >
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--cc-warn)]" />
        <span className="font-medium text-[var(--cc-text)]">Select claims to verify</span>
        <span className="text-muted-foreground">Review the extracted claims and choose which ones to verify with MiroMind.</span>
      </div>
    );
  }
  if (runStatus === "failed") {
    return (
      <div
        role="alert"
        className="flex h-12 items-center gap-3 overflow-x-auto border-b border-[var(--cc-danger)]/40 bg-[var(--cc-danger)]/10 px-4 text-xs text-[var(--cc-danger)]"
      >
        <span className="shrink-0 font-medium">Audit did not complete.</span>
        <span className="min-w-0 truncate">
          {reason ?? job?.failure?.message ?? "The run stopped before every selected claim was verified."}
        </span>
        <span className="hidden shrink-0 text-[var(--cc-danger)]/80 sm:inline">
          Findings recorded before the stop remain visible.
        </span>
      </div>
    );
  }
  if (runStatus === "connecting" || job === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-12 items-center gap-3 border-b border-[var(--cc-border)] bg-muted px-4 text-xs"
      >
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
        <span className="text-[var(--cc-text)]">
          Connecting to the audit… the socket opens with the job as it now stands.
        </span>
      </div>
    );
  }

  const steps = job.traces.reduce((n, t) => n + t.steps.length, 0);
  const running = job.stages.filter((s) => s.status === "running");
  const activeAgent = running.length > 0 ? running[running.length - 1].key : null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-12 items-center gap-3 overflow-x-auto border-b border-[var(--cc-border)] bg-muted px-4 text-xs"
    >
      <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--cc-ok)]" />
      <span className="shrink-0 text-[var(--cc-text)]">
        {runStatus === "verifying" ? "Verifying claims" : "Audit running"}…{" "}
        <strong>{steps}</strong> steps · <strong>{job.findings.length}</strong> findings
      </span>
      {activeAgent && (
        <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
          <span className="text-muted-foreground">stage</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-[var(--cc-text)]">
            {activeAgent}
          </code>
        </span>
      )}
    </div>
  );
}
