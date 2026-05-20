"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useArgusStore } from "@/lib/store";
import { ArgusHeader } from "@/components/argus-header";
import { JobStatsBar } from "@/components/job-stats-bar";
import { ReasoningPanel } from "@/components/reasoning-panel";
import { TraceStreamView } from "@/components/trace-stream-view";
import { ThemeToggle } from "@/components/theme-toggle";
import { ShortcutsHint } from "@/components/shortcuts-hint";
import { useFindingKeyboardNav } from "@/lib/use-keyboard-nav";
import { subscribeTrace } from "@/lib/trace-ws";
import { getJob } from "@/lib/api";
import type { Job, LiveFinding, Step } from "@/lib/types";

// pdf.js references browser-only globals (DOMMatrix, etc.) that fail under SSR.
// Force the PdfViewer to client-only.
const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-muted">
        <div className="animate-shimmer h-3 w-48 rounded-full" aria-hidden />
        <span className="sr-only">Loading PDF viewer</span>
      </div>
    ),
  },
);

type RightMode = "reasoning" | "stream";

export default function AuditPage() {
  const router = useRouter();
  const params = useSearchParams();
  const liveId = params.get("id");
  const demo = params.get("demo");

  const job = useArgusStore((s) => s.job);
  const activeFindingId = useArgusStore((s) => s.activeFindingId);
  const setActiveFinding = useArgusStore((s) => s.setActiveFinding);
  const liveSteps = useArgusStore((s) => s.liveSteps);
  const liveFindings = useArgusStore((s) => s.liveFindings);
  const runStatus = useArgusStore((s) => s.runStatus);
  const runError = useArgusStore((s) => s.runError);
  const setJob = useArgusStore((s) => s.setJob);
  const appendLiveStep = useArgusStore((s) => s.appendLiveStep);
  const appendLiveFinding = useArgusStore((s) => s.appendLiveFinding);
  const setRunStatus = useArgusStore((s) => s.setRunStatus);
  const resetLive = useArgusStore((s) => s.resetLive);

  const [mode, setMode] = useState<RightMode>("reasoning");
  const [hintOpen, setHintOpen] = useState(false);

  useFindingKeyboardNav(() => setHintOpen((v) => !v));

  // Live mode: open WS, accumulate, GET on finished.
  useEffect(() => {
    if (!liveId) return;
    resetLive();
    setRunStatus("running");

    const disconnect = subscribeTrace(liveId, {
      onEvent: (ev) => {
        if (ev.kind === "step") {
          const step = stepFromPayload(ev.payload);
          if (step) appendLiveStep(step);
        } else if (ev.kind === "finding") {
          const f = findingFromPayload(ev.payload);
          if (f) appendLiveFinding(f);
        } else if (ev.kind === "finished") {
          getJob(liveId)
            .then((full) => {
              setJob(full);
              setRunStatus("done");
              setMode("reasoning");
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              setRunStatus("failed", `Could not load final job: ${msg}`);
            });
        } else if (ev.kind === "failed") {
          const reason =
            typeof ev.payload.reason === "string" ? ev.payload.reason : "unknown";
          setRunStatus("failed", reason);
        }
      },
      onError: (err) => {
        setRunStatus("failed", err.message);
      },
    });
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveId]);

  // No id, no demo, no job → bounce home.
  useEffect(() => {
    if (!liveId && !demo && !job) {
      router.replace("/");
    }
  }, [liveId, demo, job, router]);

  // Live, pre-finished view: show banner + live trace + live findings preview.
  if (liveId && !job) {
    return (
      <>
        <ArgusHeader
          rightSlot={
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          }
        />
        <RunBanner runStatus={runStatus} steps={liveSteps.length} findings={liveFindings.length} reason={runError} />
        <main className="grid h-[calc(100vh-3.5rem-3rem)] grid-cols-1 md:grid-cols-[1fr_440px] lg:grid-cols-[1fr_480px]">
          <div className="hidden md:flex h-full items-center justify-center bg-muted/30 text-sm text-muted-foreground">
            PDF preview unlocks when the audit finishes.
          </div>
          <aside className="flex flex-col border-l border-border md:border-l">
            <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Live findings preview
              </span>
            </div>
            <LiveFindingsList findings={liveFindings} />
            <div className="border-t border-border h-[18rem] min-h-0 flex flex-col">
              {/* @ts-expect-error - TraceStreamView updated in T7 */}
              <TraceStreamView job={null} liveMode liveSteps={liveSteps} />
            </div>
          </aside>
        </main>
        <ShortcutsHint open={hintOpen} onClose={() => setHintOpen(false)} />
      </>
    );
  }

  if (!job) return null;

  const onClaimClick = (claimId: string) => {
    const f = job.findings.find((f) => f.claim_id === claimId);
    if (f) setActiveFinding(f.id);
  };

  const fileUrl = "/sample-report.pdf";

  return (
    <>
      <ArgusHeader
        rightSlot={
          <div className="flex items-center gap-2">
            <ExportButton job={job} />
            <ThemeToggle />
          </div>
        }
      />
      <JobStatsBar job={job} />
      <main className="grid h-[calc(100vh-3.5rem-2.75rem)] grid-cols-1 md:grid-cols-[1fr_440px] lg:grid-cols-[1fr_480px]">
        <div className="hidden md:block">
          <PdfViewer
            fileUrl={fileUrl}
            claims={job.claims}
            findings={job.findings}
            activeFindingId={activeFindingId}
            onClaimClick={onClaimClick}
          />
        </div>
        <aside className="flex flex-col border-l border-border md:border-l">
          <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-3 py-2">
            <ModeToggle current={mode} onChange={setMode} />
          </div>
          <div className="flex-1 overflow-hidden">
            {mode === "reasoning" ? (
              <ReasoningPanel
                job={job}
                activeFindingId={activeFindingId}
                onSelectFinding={setActiveFinding}
              />
            ) : (
              <TraceStreamView job={job} />
            )}
          </div>
        </aside>
      </main>
      <ShortcutsHint open={hintOpen} onClose={() => setHintOpen(false)} />
    </>
  );
}

function RunBanner({
  runStatus,
  steps,
  findings,
  reason,
}: {
  runStatus: "idle" | "running" | "done" | "failed";
  steps: number;
  findings: number;
  reason: string | null;
}) {
  if (runStatus === "failed") {
    return (
      <div
        role="alert"
        className="flex h-12 items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 text-xs text-destructive-foreground"
      >
        Audit failed — {reason ?? "unknown"}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-12 items-center gap-3 border-b border-border bg-muted/40 px-4 text-xs"
    >
      <span aria-hidden className="size-2 animate-pulse rounded-full bg-success" />
      <span>
        Audit running… <strong>{steps}</strong> steps, <strong>{findings}</strong> findings so far.
      </span>
    </div>
  );
}

function LiveFindingsList({ findings }: { findings: LiveFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="p-6 text-xs text-muted-foreground">
        Findings will appear here as agents finish each claim…
      </p>
    );
  }
  const sev = (s: LiveFinding["severity"]): string =>
    s === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : s === "major"
        ? "border-amber-500/40 bg-amber-50 dark:bg-amber-950/30"
        : "border-border bg-background";
  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-3">
      {findings.map((f) => (
        <li
          key={f.id}
          className={`rounded-[var(--radius-card)] border ${sev(f.severity)} px-3 py-2 text-xs`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{f.agent}</span>
            <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
              {f.severity} · {f.verdict}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">{f.summary}</p>
        </li>
      ))}
    </ul>
  );
}

function ExportButton({ job }: { job: Job }) {
  const onClick = () => {
    const blob = new Blob([JSON.stringify(job, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${job.id}.findings.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
      aria-label="Download this job's findings.json"
    >
      <span aria-hidden>⤓</span> Export
    </button>
  );
}

function ModeToggle({
  current,
  onChange,
}: {
  current: RightMode;
  onChange: (m: RightMode) => void;
}) {
  const opts: Array<{ key: RightMode; label: string }> = [
    { key: "reasoning", label: "Reasoning" },
    { key: "stream", label: "Live trace" },
  ];
  return (
    <div className="flex w-full gap-1 rounded-md bg-background p-0.5 ring-1 ring-border">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={current === o.key}
          className={`min-h-9 flex-1 rounded px-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
            current === o.key
              ? "bg-primary text-white"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- payload coercion ------------------------------------------------------

function stepFromPayload(payload: Record<string, unknown>): Step | null {
  if (typeof payload.trace_id !== "string") return null;
  return {
    id: `live_${payload.trace_id}_${Math.random().toString(36).slice(2, 8)}`,
    trace_id: String(payload.trace_id),
    sequence: Number(payload.total_tokens ?? 0),
    type: "message",
    summary: `${String(payload.agent ?? "agent")} — ${String(payload.claim_id ?? "")}`.trim(),
    content: payload,
    evidence_ids: [],
    parent_step_id: null,
    created_at: new Date().toISOString(),
  };
}

function findingFromPayload(payload: Record<string, unknown>): LiveFinding | null {
  if (
    typeof payload.finding_id !== "string" ||
    typeof payload.claim_id !== "string" ||
    typeof payload.agent !== "string" ||
    typeof payload.verdict !== "string" ||
    typeof payload.severity !== "string" ||
    typeof payload.summary !== "string"
  ) {
    return null;
  }
  return {
    id: payload.finding_id,
    claim_id: payload.claim_id,
    agent: payload.agent,
    verdict: payload.verdict as LiveFinding["verdict"],
    severity: payload.severity as LiveFinding["severity"],
    summary: payload.summary,
  };
}
