"use client";

import type { LiveHeartbeat, RunStatus } from "@/lib/types";

export function RunBanner({
  runStatus,
  steps,
  findings,
  reason,
  activeAgent,
  heartbeat,
}: {
  runStatus: RunStatus;
  steps: number;
  findings: number;
  reason: string | null;
  activeAgent?: string;
  heartbeat?: LiveHeartbeat | null;
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
          {reason ?? "The run stopped before every selected claim was verified."}
        </span>
        <span className="hidden shrink-0 text-[var(--cc-danger)]/80 sm:inline">
          Streamed findings remain visible; rerun or refresh to check server state.
        </span>
      </div>
    );
  }
  if (runStatus === "connecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-12 items-center gap-3 border-b border-[var(--cc-border)] bg-muted px-4 text-xs"
      >
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
        <span className="text-[var(--cc-text)]">
          Waking the audit backend… connecting to the live trace. Final results will still load by polling if the socket is slow.
        </span>
      </div>
    );
  }
  const verb = runStatus === "verifying" ? "Verifying claims" : "Audit running";
  const heartbeatText = heartbeat
    ? `${heartbeat.message} ${Math.round(heartbeat.elapsed_s)}s`
    : null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-12 items-center gap-3 overflow-x-auto border-b border-[var(--cc-border)] bg-muted px-4 text-xs"
    >
      <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--cc-ok)]" />
      <span className="shrink-0 text-[var(--cc-text)]">
        {verb}… <strong>{steps}</strong> steps · <strong>{findings}</strong> findings
      </span>
      {activeAgent && (
        <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
          <span className="text-muted-foreground">last agent</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-[var(--cc-text)]">
            {activeAgent}
          </code>
        </span>
      )}
      {heartbeatText && (
        <span className="min-w-0 shrink-0 truncate text-muted-foreground sm:max-w-[22rem]">
          {heartbeatText}
        </span>
      )}
    </div>
  );
}
