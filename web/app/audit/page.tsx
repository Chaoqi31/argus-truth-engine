"use client";

import { Suspense, useEffect, useState } from "react";
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
import { loadSampleJob } from "@/lib/load-job";
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
  return (
    <Suspense fallback={null}>
      <AuditPageContent />
    </Suspense>
  );
}

function AuditPageContent() {
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

    // PM-fix #2: detect bogus job_ids quickly. Without this, hitting
    // /audit/abc-fake-id (or refreshing after the in-memory state was
    // cleared) shows "Audit running… 0 steps · 0 findings" forever with no
    // way out. A 404 from GET /jobs/<id> means the job genuinely isn't
    // tracked — flip to failed with a clear reason.
    let cancelled = false;
    getJob(liveId).catch((err: unknown) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (/\b404\b|not found/i.test(msg)) {
        setRunStatus(
          "failed",
          `No audit with id "${liveId}" — it may have expired, or the URL is wrong.`,
        );
      }
    });

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
    return () => {
      cancelled = true;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveId]);

  // PM-fix #1: when /audit?demo=1 is hit directly (URL share, refresh, or
  // judge typing it in), bootstrap the sample job ourselves instead of
  // bouncing home — the prior behaviour rendered a blank page because the
  // sample was only loaded by the landing-page button. Without this, the
  // most common demo URL broke on refresh.
  useEffect(() => {
    if (liveId) return; // live mode owns the page
    if (job) return; // already loaded (e.g. via landing button)
    if (demo) {
      let cancelled = false;
      loadSampleJob()
        .then((sample) => {
          if (!cancelled) setJob(sample);
        })
        .catch((err: unknown) => {
          // Fallback: send them home with a console hint rather than a blank.
          // eslint-disable-next-line no-console
          console.error("loadSampleJob failed", err);
          if (!cancelled) router.replace("/");
        });
      return () => {
        cancelled = true;
      };
    }
    router.replace("/");
  }, [liveId, demo, job, router, setJob]);

  // Live, pre-finished view: show banner + PDF + live trace + live findings preview.
  if (liveId && !job) {
    const lastStep = liveSteps[liveSteps.length - 1] ?? null;
    const lastAgent =
      lastStep?.content && typeof lastStep.content === "object" && lastStep.content !== null
        ? String((lastStep.content as Record<string, unknown>).agent ?? "")
        : "";
    const tokensSoFar = liveSteps.reduce((sum, s) => {
      const t =
        s.content && typeof s.content === "object" && s.content !== null
          ? Number((s.content as Record<string, unknown>).total_tokens ?? 0)
          : 0;
      return sum + (Number.isFinite(t) ? t : 0);
    }, 0);
    const livePdfUrl = `/api/argus/jobs/${encodeURIComponent(liveId)}/pdf`;
    return (
      <>
        <ArgusHeader
          rightSlot={
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          }
        />
        <RunBanner
          runStatus={runStatus}
          steps={liveSteps.length}
          findings={liveFindings.length}
          reason={runError}
          activeAgent={lastAgent}
          tokens={tokensSoFar}
        />
        <main className="grid h-[calc(100vh-3.5rem-3rem)] grid-cols-1 md:grid-cols-[1fr_440px] lg:grid-cols-[1fr_480px]">
          <div className="hidden md:block">
            <PdfViewer
              fileUrl={livePdfUrl}
              claims={[]}
              findings={[]}
              activeFindingId={null}
              onClaimClick={() => {}}
            />
          </div>
          <aside className="flex flex-col border-l border-border md:border-l">
            <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Live findings preview
              </span>
            </div>
            <LiveFindingsList findings={liveFindings} />
            <div className="border-t border-border h-[18rem] min-h-0 flex flex-col">
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

  const fileUrl = liveId ? `/api/argus/jobs/${encodeURIComponent(job.id)}/pdf` : "/sample-report.pdf";

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
      <VerdictBanner job={job} />
      <JobStatsBar job={job} />
      <main className="grid h-[calc(100vh-3.5rem-2.75rem-2.75rem)] grid-cols-1 md:grid-cols-[1fr_440px] lg:grid-cols-[1fr_480px]">
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

// PM-fix #3: a plain-English headline above the dense stats bar so a judge
// (or analyst) gets the bottom-line verdict in one glance instead of having
// to assemble it from finding cards. Pure derivation from Job — no new state.
function VerdictBanner({ job }: { job: Job }) {
  const sev = { critical: 0, major: 0, minor: 0 };
  for (const f of job.findings) {
    if (f.severity === "critical") sev.critical++;
    else if (f.severity === "major") sev.major++;
    else if (f.severity === "minor") sev.minor++;
  }
  const issues = sev.critical + sev.major + sev.minor;
  const verdicts = new Set(job.findings.map((f) => f.verdict));
  const flags: string[] = [];
  if (verdicts.has("fabricated")) flags.push("fabricated citations");
  if (verdicts.has("mismatch") || verdicts.has("misrepresented"))
    flags.push("misaligned quotes");
  if (verdicts.has("stale") || verdicts.has("superseded")) flags.push("stale data");
  if (verdicts.has("contradiction")) flags.push("internal contradictions");

  const tone: "danger" | "warn" | "ok" =
    sev.critical > 0 ? "danger" : sev.major > 0 ? "warn" : "ok";
  const toneClasses: Record<typeof tone, string> = {
    danger: "border-destructive/40 bg-destructive/5",
    warn: "border-amber-500/40 bg-amber-50 dark:bg-amber-950/30",
    ok: "border-success/40 bg-success/5",
  };
  const dotClasses: Record<typeof tone, string> = {
    danger: "bg-destructive",
    warn: "bg-amber-500",
    ok: "bg-success",
  };

  let headline: string;
  if (issues === 0) {
    headline = "Argus found no issues in this report.";
  } else if (flags.length > 0) {
    const joined =
      flags.length === 1
        ? flags[0]
        : flags.slice(0, -1).join(", ") + " and " + flags[flags.length - 1];
    headline = `Argus flagged this report for ${joined}.`;
  } else {
    headline = "Argus found issues worth reviewing.";
  }

  const counts: string[] = [];
  if (sev.critical) counts.push(`${sev.critical} critical`);
  if (sev.major) counts.push(`${sev.major} major`);
  if (sev.minor) counts.push(`${sev.minor} minor`);

  return (
    <div
      role="status"
      className={`flex h-11 items-center gap-3 border-b px-6 text-sm ${toneClasses[tone]}`}
    >
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${dotClasses[tone]}`} />
      <span className="font-medium">{headline}</span>
      {counts.length > 0 && (
        <span className="text-muted-foreground">
          {counts.join(" · ")} across {job.claims.length}{" "}
          {job.claims.length === 1 ? "claim" : "claims"}
        </span>
      )}
    </div>
  );
}

function RunBanner({
  runStatus,
  steps,
  findings,
  reason,
  activeAgent,
  tokens,
}: {
  runStatus: "idle" | "running" | "done" | "failed";
  steps: number;
  findings: number;
  reason: string | null;
  activeAgent?: string;
  tokens?: number;
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
  // Blended estimate using mini's input/output mix (~$2.50 per M tokens).
  // True billing arrives with the finished Job; this is just a live cue.
  const estCost = tokens && tokens > 0 ? (tokens * 2.5) / 1_000_000 : 0;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-12 items-center gap-3 overflow-x-auto border-b border-border bg-muted/40 px-4 text-xs"
    >
      <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-success" />
      <span className="shrink-0">
        Audit running… <strong>{steps}</strong> steps · <strong>{findings}</strong> findings
      </span>
      {activeAgent && (
        <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
          <span className="text-muted-foreground">last agent</span>
          <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px]">
            {activeAgent}
          </code>
        </span>
      )}
      {tokens !== undefined && tokens > 0 && (
        <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
          <span className="text-muted-foreground">tokens</span>
          <span className="font-mono tabular-nums">{tokens.toLocaleString()}</span>
          <span className="text-muted-foreground">· est</span>
          <span className="font-mono tabular-nums">${estCost.toFixed(2)}</span>
        </span>
      )}
    </div>
  );
}

function LiveFindingsList({ findings }: { findings: LiveFinding[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-3">
      {findings.map((f) => {
        const isOpen = expanded.has(f.id);
        return (
          <li
            key={f.id}
            className={`rounded-[var(--radius-card)] border ${sev(f.severity)} text-xs`}
          >
            <button
              type="button"
              onClick={() => toggle(f.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="font-medium">{f.agent}</span>
              <span className="flex items-center gap-2 font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                {f.severity} · {f.verdict}
                <span aria-hidden className="text-foreground/60">
                  {isOpen ? "▾" : "▸"}
                </span>
              </span>
            </button>
            <p
              className={`px-3 pb-2 text-muted-foreground ${isOpen ? "" : "line-clamp-2"}`}
              title={isOpen ? undefined : f.summary}
            >
              {f.summary}
            </p>
          </li>
        );
      })}
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
    { key: "stream", label: "Trace" },
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
