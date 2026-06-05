"use client";

import { type CSSProperties, Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useArgusStore, type ConsoleMode } from "@/lib/store";
import { ArgusHeader } from "@/components/argus-header";
import { JobStatsBar } from "@/components/job-stats-bar";
import { FindingsTab } from "@/components/findings-tab";
import { EvidenceTab } from "@/components/evidence-tab";
import { TraceStreamView } from "@/components/trace-stream-view";
import { ShortcutsHint } from "@/components/shortcuts-hint";
import { ScenarioBanner } from "@/components/scenario-banner";
import { ExportMenu, type ExportFormat } from "@/components/export-menu";
import { ApiKeyInput } from "@/components/api-key-input";
import { useFindingKeyboardNav } from "@/lib/use-keyboard-nav";
import { subscribeTrace } from "@/lib/trace-ws";
import {
  getJob,
  uploadPdf,
  submitText,
  UnsupportedMediaTypeError,
  ArgusApiError,
  JobNotFoundError,
} from "@/lib/api";
import { loadSampleJob, type Scenario } from "@/lib/load-job";
import { replayTrace } from "@/lib/trace-replayer";
import { buildAuditPackMarkdown, buildEvidenceStationJson } from "@/lib/audit-pack";
import { orderFindingsForDemoReplay } from "@/lib/demo-replay";
import { sortFindingsForReview } from "@/lib/findings";
import type { FilteredClaim, Finding, Job, LiveFinding, ReviewClaim, RunStatus, Step, StepType } from "@/lib/types";
import { TextViewer } from "@/components/text-viewer";
import { ClaimReviewPanel } from "@/components/claim-review-panel";
import { FindingDrawer } from "@/components/cockpit/finding-drawer";
import { CommandPalette } from "@/components/cockpit/command-palette";
import { EvidenceDiff } from "@/components/cockpit/evidence-diff";
import { ReasoningWalkthroughCta } from "@/components/reasoning-walkthrough-cta";
import { DemoRunControls } from "@/components/demo-run-controls";
import { PdfUploadDropzone } from "@/components/pdf-upload-dropzone";
import CountUp from "@/components/react-bits/CountUp";
import BlurText from "@/components/react-bits/BlurText";

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

const DEMO_START_LINK =
  "inline-flex items-center justify-center rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary";

/** Global ⌘K / Ctrl+K listener that toggles the command palette. */
function useCommandPaletteHotkey() {
  const setPaletteOpen = useArgusStore((s) => s.setPaletteOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);
}

/** Prominent search pill that opens the ⌘K command palette. */
function PaletteHint() {
  const setPaletteOpen = useArgusStore((s) => s.setPaletteOpen);
  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      aria-label="Search findings (Command K)"
      className="hidden items-center gap-2 rounded-[10px] border border-[var(--cc-border)] bg-[var(--cc-bg)] px-3 py-1.5 text-[13px] text-[var(--cc-text-muted)] shadow-[var(--shadow-card)] transition-colors hover:border-[var(--cc-primary)] hover:text-[var(--cc-text)] sm:inline-flex"
    >
      <SearchIcon />
      <span className="min-w-[8.5rem] text-left">Search findings…</span>
      <kbd className="rounded border border-[var(--cc-border)] bg-[var(--cc-surface)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--cc-text-muted)]">
        ⌘K
      </kbd>
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0">
      <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.2 9.2L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Cockpit column sizing (lg only). Document + console are px-resizable; the
// middle findings column flexes. Hard min/max clamps keep every zone usable.
const COCKPIT_DOC_MIN = 300;
const COCKPIT_DOC_MAX = 560;
const COCKPIT_DOC_DEFAULT = 520;
const COCKPIT_CONSOLE_MIN = 340;
const COCKPIT_CONSOLE_MAX = 760;
const COCKPIT_CONSOLE_DEFAULT = 400;
const clampPx = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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
  const setDrawerFinding = useArgusStore((s) => s.setDrawerFinding);
  const liveSteps = useArgusStore((s) => s.liveSteps);
  const liveFindings = useArgusStore((s) => s.liveFindings);
  const runStatus = useArgusStore((s) => s.runStatus);
  const runError = useArgusStore((s) => s.runError);
  const findingReviews = useArgusStore((s) => s.findingReviews);
  const setJob = useArgusStore((s) => s.setJob);
  const appendLiveStep = useArgusStore((s) => s.appendLiveStep);
  const appendLiveFinding = useArgusStore((s) => s.appendLiveFinding);
  const setRunStatus = useArgusStore((s) => s.setRunStatus);
  const resetLive = useArgusStore((s) => s.resetLive);
  const setReviewReady = useArgusStore((s) => s.setReviewReady);
  const clearStore = useArgusStore((s) => s.clear);

  const consoleMode = useArgusStore((s) => s.consoleMode);
  const setConsoleMode = useArgusStore((s) => s.setConsoleMode);
  const [hintOpen, setHintOpen] = useState(false);
  const [docW, setDocW] = useState(COCKPIT_DOC_DEFAULT);
  const [consoleW, setConsoleW] = useState(COCKPIT_CONSOLE_DEFAULT);

  // Demo playback: the fixture is loaded but HELD (not pushed to the store) so
  // we can show an idle "input + Run" screen first, then stream it through the
  // live UI on click. `demoRunning` flips on once playback starts.
  const [demoJob, setDemoJob] = useState<Job | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [scenario, setScenario] = useState<Scenario>(() =>
    params.get("scenario") === "nvidia" ? "nvidia" : "legal",
  );
  const demoAbortRef = useRef<AbortController | null>(null);
  // Guards the one-time terminal transition (done/failed) for the live run so
  // the WS `finished` path and the polling fallback can't double-load or race.
  const settledRef = useRef(false);

  useFindingKeyboardNav(() => setHintOpen((v) => !v));
  useCommandPaletteHotkey();

  const onExport = async (fmt: ExportFormat) => {
    if (!job) return;
    const exportId = liveId ?? job.id ?? "demo";
    if (fmt === "audit_pack") {
      downloadText(
        `argus-audit-pack-${exportId}.md`,
        buildAuditPackMarkdown(job, findingReviews),
        "text/markdown",
      );
    } else if (fmt === "json") {
      downloadText(
        `argus-evidence-station-${exportId}.json`,
        buildEvidenceStationJson(job, findingReviews),
        "application/json",
      );
    } else {
      downloadText(
        `argus-executive-summary-${exportId}.md`,
        job.audit_report_md ?? "",
        "text/markdown",
      );
    }
  };

  // Live mode: open WS, accumulate, GET on finished. Hardened for Fly cold
  // start — a transient WS error never fails the run; a polling fallback loads
  // the finished job even if the WS never connects.
  useEffect(() => {
    if (!liveId) return;
    resetLive();
    setRunStatus("connecting");

    let cancelled = false;
    settledRef.current = false;
    let disconnect: () => void = () => {};
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Single terminal transition. Both the WS `finished` path and the poll
    // funnel through here so there's no double-load / race; cleans up after.
    const settle = (status: RunStatus, reason?: string) => {
      if (cancelled || settledRef.current) return;
      settledRef.current = true;
      setRunStatus(status, status === "failed" ? (reason ?? "unknown") : null);
      disconnect();
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    // Shared done path: stage the full job, then settle to done.
    const settleDone = (full: Job) => {
      if (cancelled || settledRef.current) return;
      setJob(full);
      setConsoleMode("evidence");
      settle("done");
    };

    disconnect = subscribeTrace(liveId, {
      onConnected: () => {
        // Upgrade only connecting → running; never downgrade verifying/reviewing
        // on a mid-stream reconnect.
        if (useArgusStore.getState().runStatus === "connecting") {
          setRunStatus("running");
        }
      },
      onEvent: (ev) => {
        if (ev.kind === "step") {
          const step = stepFromPayload(ev.payload);
          if (step) appendLiveStep(step);
        } else if (ev.kind === "finding") {
          const f = findingFromPayload(ev.payload);
          if (f) appendLiveFinding(f);
        } else if (ev.kind === "finished") {
          getJob(liveId)
            .then((full) => settleDone(full))
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              settle("failed", `Could not load final job: ${msg}`);
            });
        } else if (ev.kind === "review_ready") {
          const claims = (ev.payload.claims ?? []) as ReviewClaim[];
          const filtered = (ev.payload.filtered ?? []) as FilteredClaim[];
          setReviewReady(claims, filtered);
        } else if (ev.kind === "resumed") {
          setRunStatus("verifying");
        } else if (ev.kind === "failed") {
          const reason =
            typeof ev.payload.reason === "string" ? ev.payload.reason : "unknown";
          settle("failed", reason);
        }
      },
      // Advisory only — a transient connection error must NOT fail the run.
      onError: () => {},
      onGiveUp: () => {
        settle(
          "failed",
          "Lost connection to the live trace. The audit may still be running — refresh to check.",
        );
      },
    });

    // Polling fallback. One immediate call gives a fast 404; the interval keeps
    // checking so a finished job still loads even if the WS never connects, and
    // a cold-start network error never fails the run.
    const poll = () => {
      getJob(liveId)
        .then((full) => {
          if (cancelled || settledRef.current) return;
          if (full.status === "done") {
            settleDone(full);
          } else if (full.status === "failed") {
            settle("failed", "The audit failed on the server.");
          }
          // in progress → keep polling
        })
        .catch((err: unknown) => {
          if (cancelled || settledRef.current) return;
          if (err instanceof JobNotFoundError) {
            settle(
              "failed",
              `No audit with id "${liveId}" — it may have expired, or the URL is wrong.`,
            );
          }
          // other (cold-start) network errors → ignore, keep polling
        });
    };
    poll();
    pollTimer = setInterval(poll, 4000);

    return () => {
      cancelled = true;
      disconnect();
      if (pollTimer !== null) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveId]);

  // Demo mode (/audit?demo=1): load the bundled fixture but HOLD it in local
  // state instead of pushing it straight to the store. This lets us render an
  // idle "report + Run" screen first; clicking Run replays the fixture through
  // the live UI (see runDemo). Hitting the URL directly (share/refresh) still
  // works — it just lands on the idle screen rather than a blank page.
  useEffect(() => {
    if (liveId) return; // live mode owns the page
    if (job) return; // already running/finished
    if (!demo) return; // no demo → input UI (see AuditInputPage below)
    let cancelled = false;
    // Reloads when `scenario` changes so the picker can swap fixtures. Keeps the
    // previous demoJob visible until the new one resolves (local fetch is fast).
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

  // Abort any in-flight demo playback if the page unmounts mid-stream.
  useEffect(() => () => demoAbortRef.current?.abort(), []);

  // /audit must always mean "start a new audit". Without this, a finished demo
  // left in the client store can make the Start auditing CTA reopen the old demo.
  useEffect(() => {
    if (liveId || demo || !job) return;
    demoAbortRef.current?.abort();
    clearStore();
  }, [liveId, demo, job, clearStore]);

  // Drive the live store from the held fixture so the demo *feels* like a
  // real-time audit: reset live state, stream the merged trace steps with the
  // shared replayer's timed reveal, surface findings progressively as steps
  // appear, then commit the finished job → full cockpit. No network call.
  const runDemo = () => {
    if (!demoJob || demoRunning) return;
    demoAbortRef.current?.abort();
    const controller = new AbortController();
    demoAbortRef.current = controller;
    const { signal } = controller;

    resetLive();
    setRunStatus("running");
    setDemoRunning(true);

    const findings = orderFindingsForDemoReplay(demoJob);
    const claimText = new Map(demoJob.claims.map((c) => [c.id, c.text]));
    const traceById = new Map(demoJob.traces.map((t) => [t.id, t]));
    const stagesByKey = new Map((demoJob.stages ?? []).map((s) => [s.key, s]));
    const findingIndex = new Map(findings.map((f, k) => [f.id, k] as const));

    // Stream a single timeline that narrates the WHOLE pipeline, in order:
    // pre-verify stages → per-claim MiroMind deep research → post-verify stages.
    // Stage/claim markers are synthetic Step-shaped items (content.__stage /
    // content.__claim — only ever injected here, never in the fixture); the real
    // MiroMind steps are the fixture's. replayTrace sorts by sequence, so each
    // item gets a monotonic seq to preserve this order. revealAt[k] = the event
    // count after which finding k surfaces.
    let seq = 0;
    const timeline: Step[] = [];
    const revealAt = new Array<number>(findings.length).fill(0);
    const marker = (content: Record<string, unknown>, summary: string): Step => ({
      id: `pipe-${seq}`,
      trace_id: "__pipeline",
      sequence: ++seq,
      type: "message",
      summary,
      content,
      evidence_ids: [],
      parent_step_id: null,
      created_at: "",
    });
    const pushStage = (key: string) => {
      const st = stagesByKey.get(key);
      if (!st) return;
      timeline.push(
        marker(
          { __stage: { key: st.key, name: st.name, engine: st.engine, summary: st.summary } },
          st.summary,
        ),
      );
    };

    (["parse", "planner", "atomizer", "checkworthiness", "review_gate"] as const).forEach(pushStage);

    const verifiers = findings.filter((f) => f.agent === "UnifiedVerifier");
    verifiers.forEach((f, i) => {
      const trace = traceById.get(f.reasoning_trace_id);
      const tsteps = trace ? [...trace.steps].sort((a, b) => a.sequence - b.sequence) : [];
      if (tsteps.length === 0) return;
      const text = claimText.get(f.claim_id) ?? f.summary;
      timeline.push(marker({ __claim: { index: i + 1, total: verifiers.length, text } }, text));
      tsteps.forEach((s) => timeline.push({ ...s, sequence: ++seq }));
      const k = findingIndex.get(f.id);
      if (k !== undefined) revealAt[k] = timeline.length;
    });

    (["consistency", "confidence", "reporter"] as const).forEach((key) => {
      pushStage(key);
      if (key === "consistency") {
        findings
          .filter((f) => f.agent === "Consistency")
          .forEach((f) => {
            const k = findingIndex.get(f.id);
            if (k !== undefined) revealAt[k] = timeline.length;
          });
      }
    });

    const revealed = new Set<number>();
    let shown = 0;

    void replayTrace(
      timeline,
      (step) => {
        appendLiveStep(step);
        shown += 1;
        findings.forEach((f, k) => {
          if (!revealed.has(k) && revealAt[k] > 0 && shown >= revealAt[k]) {
            appendLiveFinding(toLiveFinding(f));
            revealed.add(k);
          }
        });
      },
      { signal },
    ).then(() => {
      if (signal.aborted) return;
      // Flush any findings not yet surfaced, then hand off to the cockpit.
      findings.forEach((f, k) => {
        if (!revealed.has(k)) appendLiveFinding(toLiveFinding(f));
      });
      setJob(demoJob);
      setRunStatus("done");
      setConsoleMode("evidence");
      setDemoRunning(false);
    });
  };

  // Re-watch the demo: fully reset the store (clears the finished job + live
  // state) and stream the held fixture through the live UI again. demoJob lives
  // in local state, so it survives the store clear.
  const replayDemo = () => {
    clearStore();
    runDemo();
  };

  const finishDemoNow = () => {
    if (!demoJob) return;
    demoAbortRef.current?.abort();
    setJob(demoJob);
    setRunStatus("done");
    setConsoleMode("evidence");
    setDemoRunning(false);
  };

  const startAuditingFromDemo = () => {
    demoAbortRef.current?.abort();
    clearStore();
  };

  const isTextMode = params.get("mode") === "text" || job?.input_mode === "text";

  // Demo idle screen: fixture loaded but not yet running — show the source
  // report + a single Run button. Clicking Run streams it through the live UI.
  if (demo && demoJob && !job && !demoRunning && runStatus === "idle") {
    return (
      <DemoIdleScreen
        job={demoJob}
        onRun={runDemo}
        onSkipToResults={finishDemoNow}
        scenario={scenario}
        onScenarioChange={setScenario}
      />
    );
  }

  // Live / demo-running view: banner + document + live trace + findings preview.
  // Real audits enter here via `liveId`; the demo enters via `demoRunning`
  // (no liveId, text-mode fixture → report text instead of the PDF viewer).
  if ((liveId || demoRunning) && !job) {
    const lastStep = liveSteps[liveSteps.length - 1] ?? null;
    const lastAgent =
      lastStep?.content && typeof lastStep.content === "object" && lastStep.content !== null
        ? String((lastStep.content as Record<string, unknown>).agent ?? "")
        : "";
    // Demo is a text-mode fixture with no backend PDF; real text audits also
    // collapse the document column. Only PDF live audits show the viewer.
    const showPdf = !!liveId && !isTextMode;
    const showReport = demoRunning && !!demoJob;
    const livePdfUrl = liveId ? `/api/argus/jobs/${encodeURIComponent(liveId)}/pdf` : "";
    const splitGrid = showPdf || showReport;
    return (
      <div className="cockpit cc-backdrop min-h-screen">
        <ArgusHeader
          rightSlot={
            <div className="flex items-center gap-2">
              {demoRunning && demoJob && (
                <Link href="/audit" onClick={startAuditingFromDemo} className={DEMO_START_LINK}>
                  Start auditing
                </Link>
              )}
              {demoRunning && demoJob && (
                <DemoRunControls onShowFullAudit={finishDemoNow} />
              )}
              <PaletteHint />
              <ExportMenu onSelect={onExport} disabled={runStatus !== "done"} />
            </div>
          }
        />
        <RunBanner
          runStatus={runStatus}
          steps={liveSteps.length}
          findings={liveFindings.length}
          reason={runError}
          activeAgent={lastAgent}
        />
        <main className={`grid grid-rows-1 h-[calc(100vh-3.5rem-3rem)] grid-cols-1 ${splitGrid ? "md:grid-cols-[1fr_440px] lg:grid-cols-[1fr_480px]" : ""}`}>
          {showPdf ? (
            <div className="hidden md:block">
              <PdfViewer
                fileUrl={livePdfUrl}
                claims={[]}
                findings={[]}
                activeFindingId={null}
                onClaimClick={() => {}}
              />
            </div>
          ) : showReport ? (
            <div className="hidden min-h-0 md:block">
              <TextViewer
                text={demoJob.input_text ?? ""}
                claims={[]}
                findings={[]}
                activeFindingId={null}
                onClaimClick={() => {}}
              />
            </div>
          ) : null}
          <aside className="flex min-h-0 flex-col border-l border-[var(--cc-border)]">
            {runStatus === "reviewing" && liveId ? (
              <ClaimReviewPanel jobId={liveId} />
            ) : (
              <>
                <div className="flex items-center gap-1 border-b border-[var(--cc-border)] bg-muted px-3 py-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Live findings preview
                  </span>
                </div>
                <LiveFindingsList findings={liveFindings} />
                <div className="border-t border-[var(--cc-border)] flex-1 min-h-0 flex flex-col">
                  <TraceStreamView job={null} liveMode liveSteps={liveSteps} />
                </div>
              </>
            )}
          </aside>
        </main>
        <ShortcutsHint open={hintOpen} onClose={() => setHintOpen(false)} />
        <CommandPalette />
      </div>
    );
  }

  // No live job and no demo flag → always show the input page, even if a
  // previous demo/live result is still present in the client store.
  if (!liveId && !demo) {
    return <AuditInputPage />;
  }

  if (!job) return null;

  // Clicking a finding (card or document span): select it, and surface its
  // evidence in the right console (preserves PM-fix #4: a click must visibly
  // surface the receipts, not just thicken a border).
  const selectFinding = (id: string) => {
    setActiveFinding(id);
    setConsoleMode("evidence");
  };

  const openFindingDrawer = (id: string) => {
    setActiveFinding(id);
    setDrawerFinding(id);
  };

  const startReasoningWalkthrough = (id: string) => {
    setActiveFinding(id);
    setConsoleMode("trace");
  };

  const onClaimClick = (claimId: string) => {
    const f = sortFindingsForReview(job.findings).find((f) => f.claim_id === claimId);
    if (f) selectFinding(f.id);
  };

  const fileUrl = liveId ? `/api/argus/jobs/${encodeURIComponent(job.id)}/pdf` : "/sample-report.pdf";
  const jobIsText = job.input_mode === "text";

  return (
    <div className="cockpit cc-backdrop flex h-screen flex-col">
      <ArgusHeader
        rightSlot={
          <div className="flex items-center gap-2">
            {demo === "1" && (
              <button
                type="button"
                onClick={replayDemo}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Replay the demo audit"
              >
                <span aria-hidden>↻</span> Replay
              </button>
            )}
            {demo === "1" && (
              <Link href="/audit" onClick={startAuditingFromDemo} className={DEMO_START_LINK}>
                Start auditing
              </Link>
            )}
            <PaletteHint />
            <ExportMenu onSelect={onExport} disabled={runStatus !== "done"} />
          </div>
        }
      />
      {demo === "1" && job?.scenario_label && job?.persona && (
        <ScenarioBanner label={job.scenario_label} persona={job.persona} />
      )}
      <VerdictHero job={job} onStartReasoningWalkthrough={startReasoningWalkthrough} />
      <JobStatsBar job={job} />
      <main
        className="relative grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px] lg:[grid-template-columns:var(--cc-doc-w)_minmax(0,1fr)_var(--cc-console-w)]"
        style={{ "--cc-doc-w": `${docW}px`, "--cc-console-w": `${consoleW}px` } as CSSProperties}
      >
        {/* Zone 1 — document frame */}
        <div className="hidden h-full overflow-hidden lg:block">
          {jobIsText ? (
            <TextViewer
              text={job.input_text ?? ""}
              claims={job.claims}
              findings={job.findings}
              activeFindingId={activeFindingId}
              onClaimClick={onClaimClick}
            />
          ) : (
            <PdfViewer
              fileUrl={fileUrl}
              claims={job.claims}
              findings={job.findings}
              activeFindingId={activeFindingId}
              onClaimClick={onClaimClick}
            />
          )}
        </div>

        <ColumnResizeHandle
          anchor="left"
          position="var(--cc-doc-w)"
          ariaLabel="Resize document column"
          onDelta={(dx) => setDocW((w) => clampPx(w + dx, COCKPIT_DOC_MIN, COCKPIT_DOC_MAX))}
          onKeyStep={(dir) => setDocW((w) => clampPx(w + dir * 24, COCKPIT_DOC_MIN, COCKPIT_DOC_MAX))}
        />

        {/* Zone 2 — review queue */}
        <section className="flex min-h-0 flex-col border-[var(--cc-border)] lg:border-l">
          <div className="flex items-center gap-2 border-b border-[var(--cc-border)] bg-muted px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Review queue
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {job.findings.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FindingsTab job={job} activeFindingId={activeFindingId} onSelect={selectFinding} onOpenDrawer={openFindingDrawer} />
          </div>
        </section>

        <ColumnResizeHandle
          anchor="right"
          position="var(--cc-console-w)"
          ariaLabel="Resize reasoning console column"
          onDelta={(dx) => setConsoleW((w) => clampPx(w - dx, COCKPIT_CONSOLE_MIN, COCKPIT_CONSOLE_MAX))}
          onKeyStep={(dir) => setConsoleW((w) => clampPx(w - dir * 24, COCKPIT_CONSOLE_MIN, COCKPIT_CONSOLE_MAX))}
        />

        {/* Zone 3 — evidence and trace */}
        <aside className="flex min-h-0 flex-col border-l border-[var(--cc-border)]">
          <div className="flex items-center gap-2 border-b border-[var(--cc-border)] bg-muted px-3 py-2">
            <span className="hidden shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground xl:inline">
              Evidence trail
            </span>
            <ConsoleToggle current={consoleMode} onChange={setConsoleMode} />
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {consoleMode === "evidence" ? (
              <EvidenceTab job={job} findingId={activeFindingId} />
            ) : (
              <TraceStreamView job={job} activeFindingId={activeFindingId} />
            )}
          </div>
        </aside>
      </main>
      <ShortcutsHint open={hintOpen} onClose={() => setHintOpen(false)} />

      {/* Cockpit surfaces. Each reads its own store slot, so rendering them
          unconditionally is safe (they no-op when closed). */}
      <FindingDrawer />
      <CommandPalette />
      <EvidenceDiff />
    </div>
  );
}

/* ====================================================================== */
/*  VERDICT HERO — dramatic on-load reveal above the stats bar            */
/* ====================================================================== */
// Replaces the old flat VerdictBanner. Pure derivation from Job — no new state.
// Large headline (BlurText reveal), glowing status dot, severity counts via
// CountUp. Honors prefers-reduced-motion (BlurText/CountUp degrade gracefully
// when not in view / reduced motion via their own guards).
function VerdictHero({
  job,
  onStartReasoningWalkthrough,
}: {
  job: Job;
  onStartReasoningWalkthrough: (findingId: string) => void;
}) {
  const sev = { critical: 0, major: 0, minor: 0 };
  const issueFindings = job.findings.filter((f) => f.verdict !== "ok");
  for (const f of issueFindings) {
    if (f.severity === "critical") sev.critical++;
    else if (f.severity === "major") sev.major++;
    else if (f.severity === "minor") sev.minor++;
  }
  const issues = sev.critical + sev.major + sev.minor;
  const verdicts = new Set(job.findings.map((f) => f.verdict));
  const flags: string[] = [];
  if (verdicts.has("fabricated")) flags.push("fabricated citations");
  if (verdicts.has("mismatch") || verdicts.has("misrepresented")) {
    flags.push("misaligned quotes");
  }
  if (verdicts.has("inaccurate")) flags.push("incorrect facts");
  if (verdicts.has("outdated") || verdicts.has("stale") || verdicts.has("superseded")) flags.push("stale data");
  if (verdicts.has("contradiction")) flags.push("internal contradictions");
  if (verdicts.has("unsupported-inference") || verdicts.has("overreach")) {
    flags.push("unsupported reasoning");
  }

  const tone: "danger" | "warn" | "ok" =
    sev.critical > 0 ? "danger" : sev.major > 0 ? "warn" : "ok";
  const toneColor: Record<typeof tone, string> = {
    danger: "var(--cc-danger)",
    warn: "var(--cc-warn)",
    ok: "var(--cc-ok)",
  };

  const subject = job.input_mode === "text" ? "this content" : "this report";
  const total = job.claims_total && job.claims_total > 0 ? job.claims_total : job.claims.length;
  const audited = job.claims_audited && job.claims_audited > 0 ? job.claims_audited : job.findings.filter((f) => f.agent === "UnifiedVerifier").length;
  const partial = total > 0 && audited < total;
  const unchecked = Math.max(0, total - audited);
  const failed = job.status === "failed" || job.status === "interrupted";
  let headline: string;
  if (failed) {
    headline = `Argus stopped before completing ${subject}.`;
  } else if (partial) {
    headline = `Argus partially audited ${subject}.`;
  } else if (issues === 0) {
    headline = `Argus found no issues in ${subject}.`;
  } else if (flags.length > 0) {
    const joined =
      flags.length === 1
        ? flags[0]
        : flags.slice(0, -1).join(", ") + " and " + flags[flags.length - 1];
    headline = `Argus flagged ${subject} for ${joined}.`;
  } else {
    headline = "Argus found issues worth reviewing.";
  }

  const counts: Array<{ n: number; label: string; color: string }> = [];
  if (sev.critical) counts.push({ n: sev.critical, label: "critical", color: "var(--cc-danger)" });
  if (sev.major) counts.push({ n: sev.major, label: "major", color: "var(--cc-warn)" });
  if (sev.minor) counts.push({ n: sev.minor, label: "minor", color: "var(--cc-text-muted)" });

  return (
    <section
      role="status"
      className="relative flex min-h-20 items-center gap-4 overflow-hidden border-b border-[var(--cc-border)] px-6 py-3"
    >
      <span
        aria-hidden
        className="cc-status-dot relative size-3 shrink-0 rounded-full"
        style={{ color: toneColor[tone], backgroundColor: toneColor[tone] }}
      />
      <div className="relative min-w-0 flex-1">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Conclusion
        </p>
        <BlurText
          key={headline}
          text={headline}
          className="text-base font-bold tracking-tight text-[var(--cc-text)] md:text-lg"
          animateBy="words"
          delay={60}
        />
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {audited}/{total || job.claims.length} selected claims checked
          </span>
          <span aria-hidden>·</span>
          <span>{issues} issue{issues === 1 ? "" : "s"} found</span>
          <span aria-hidden>·</span>
          <span>{job.evidences.length} cited source{job.evidences.length === 1 ? "" : "s"}</span>
          {partial && (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium text-warning-foreground">
                {unchecked} unchecked
              </span>
            </>
          )}
        </div>
        {(partial || failed) && (
          <p className="mt-1.5 inline-flex rounded bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
            Partial coverage: review unchecked claims before relying on a clean conclusion.
          </p>
        )}
      </div>

      <div className="hidden shrink-0 items-center gap-5 sm:flex">
        {counts.length > 0 && (
          <>
          {counts.map((c) => (
            <div key={c.label} className="text-right">
              <CountUp
                to={c.n}
                duration={1.1}
                className="block font-mono text-xl font-bold tabular-nums"
              />
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ color: c.color }}
              >
                {c.label}
              </span>
            </div>
          ))}
          <div className="text-right">
            <span className="block font-mono text-xl font-bold tabular-nums text-muted-foreground">
              {audited}/{total || job.claims.length}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              checked
            </span>
          </div>
          </>
        )}
        <ReasoningWalkthroughCta job={job} onStart={onStartReasoningWalkthrough} />
      </div>
    </section>
  );
}

function RunBanner({
  runStatus,
  steps,
  findings,
  reason,
  activeAgent,
}: {
  runStatus: RunStatus;
  steps: number;
  findings: number;
  reason: string | null;
  activeAgent?: string;
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
      ? "border-[var(--cc-danger)]/40 bg-[var(--cc-danger)]/10"
      : s === "major"
        ? "border-[var(--cc-warn)]/40 bg-[var(--cc-warn)]/10"
        : "border-border bg-muted";
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <ul className="flex max-h-[42vh] shrink-0 flex-col gap-2 overflow-y-auto p-3">
      {findings.map((f) => {
        const isOpen = expanded.has(f.id);
        return (
          <li
            key={f.id}
            className={`overflow-hidden rounded-[var(--radius-card)] border ${sev(f.severity)} text-xs`}
          >
            <button
              type="button"
              onClick={() => toggle(f.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--cc-text)]">{f.verdict}</span>
              <span className="flex items-center gap-2 font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                {f.severity}
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

function ConsoleToggle({
  current,
  onChange,
}: {
  current: ConsoleMode;
  onChange: (m: ConsoleMode) => void;
}) {
  const opts: Array<{ key: ConsoleMode; label: string }> = [
    { key: "evidence", label: "Evidence" },
    { key: "trace", label: "Trace" },
  ];
  return (
    <div className="flex w-full gap-1 rounded-md bg-muted p-0.5 ring-1 ring-[var(--cc-border)]">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={current === o.key}
          className={`min-h-9 flex-1 rounded px-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
            current === o.key
              ? "bg-[var(--cc-primary)] text-white shadow-[var(--cc-glow)]"
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

const STEP_TYPES = new Set<StepType>([
  "thinking",
  "web_search",
  "fetch_url_content",
  "execute_python",
  "execute_command",
  "tool_call",
  "message",
]);

function isStepType(value: unknown): value is StepType {
  return typeof value === "string" && STEP_TYPES.has(value as StepType);
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stepFromPayload(payload: Record<string, unknown>): Step | null {
  const native = recordFrom(payload.step);
  if (native) {
    const traceId =
      typeof native.trace_id === "string"
        ? native.trace_id
        : typeof payload.trace_id === "string"
          ? payload.trace_id
          : null;
    if (!traceId) return null;

    const baseContent = recordFrom(native.content) ?? {};
    const content = {
      ...baseContent,
      agent: payload.agent,
      claim_id: payload.claim_id,
    };

    return {
      id:
        typeof native.id === "string"
          ? native.id
          : `live_${traceId}_${Math.random().toString(36).slice(2, 8)}`,
      trace_id: traceId,
      sequence:
        typeof native.sequence === "number"
          ? native.sequence
          : Number(payload.sequence ?? 0),
      type: isStepType(native.type) ? native.type : "message",
      summary:
        typeof native.summary === "string"
          ? native.summary
          : String(payload.summary ?? payload.agent ?? "agent"),
      content,
      evidence_ids: Array.isArray(native.evidence_ids)
        ? native.evidence_ids.filter((id): id is string => typeof id === "string")
        : [],
      parent_step_id: typeof native.parent_step_id === "string" ? native.parent_step_id : null,
      created_at: typeof native.created_at === "string" ? native.created_at : new Date().toISOString(),
    };
  }

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

/** Project a finished Finding down to the live-preview shape (demo playback). */
function toLiveFinding(f: Finding): LiveFinding {
  return {
    id: f.id,
    claim_id: f.claim_id,
    agent: f.agent,
    verdict: f.verdict,
    severity: f.severity,
    summary: f.summary,
  };
}

/* ====================================================================== */
/*  DEMO IDLE SCREEN — report + Run button shown before demo playback     */
/* ====================================================================== */
// Shown at /audit?demo=1 before the user clicks Run. Presents the bundled
// note read-only with a single primary action that replays the completed
// audit through the live UI. No network call — honest, neutral copy.
const DEMO_SCENARIOS: Array<{ key: Scenario; label: string }> = [
  { key: "legal", label: "Legal filing" },
  { key: "nvidia", label: "Investment research" },
];

const DEMO_COPY: Record<
  Scenario,
  { eyebrow: string; title: string; body: string; checklist: string[] }
> = {
  nvidia: {
    eyebrow: "Investment committee walkthrough",
    title: "Review an AI investment memo before committee",
    body:
      "Replay how Argus audits a vendor-style NVIDIA research note with planted factual errors, then turns the result into a claim-level review package.",
    checklist: [
      "Claims extracted from the memo",
      "Searches + sources streamed live",
      "Decisions saved to the Audit Pack",
    ],
  },
  legal: {
    eyebrow: "Legal review walkthrough",
    title: "Review an AI legal memo before filing",
    body:
      "Replay how Argus checks authority, citation fit, and source mismatch before a team relies on generated legal analysis.",
    checklist: [
      "Citations isolated by claim",
      "Source trail beside each verdict",
      "Reviewer notes kept for handoff",
    ],
  },
};

function DemoIdleScreen({
  job,
  onRun,
  onSkipToResults,
  scenario,
  onScenarioChange,
}: {
  job: Job;
  onRun: () => void;
  onSkipToResults: () => void;
  scenario: Scenario;
  onScenarioChange: (s: Scenario) => void;
}) {
  const [starting, setStarting] = useState(false);
  const clearStore = useArgusStore((s) => s.clear);
  const copy = DEMO_COPY[scenario];
  return (
    <div className="cockpit cc-backdrop min-h-screen">
      <ArgusHeader
        rightSlot={
          <Link href="/audit" onClick={clearStore} className={DEMO_START_LINK}>
            Start auditing
          </Link>
        }
      />
      {job.scenario_label && job.persona && (
        <ScenarioBanner label={job.scenario_label} persona={job.persona} />
      )}
      <main className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Report — read-only, prominent */}
        <div className="hidden min-h-0 overflow-hidden p-4 lg:block">
          <TextViewer
            text={job.input_text ?? ""}
            claims={[]}
            findings={[]}
            activeFindingId={null}
            onClaimClick={() => {}}
          />
        </div>

        {/* Action rail */}
        <aside className="flex flex-col justify-center gap-6 border-t border-[var(--cc-border)] px-8 py-12 lg:border-l lg:border-t-0">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
              Choose a scenario
            </span>
            <div className="flex gap-1 rounded-[10px] bg-muted p-0.5 ring-1 ring-[var(--cc-border)]">
              {DEMO_SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onScenarioChange(s.key)}
                  aria-pressed={scenario === s.key}
                  className={`flex-1 rounded-[8px] px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                    scenario === s.key
                      ? "bg-background text-foreground shadow-[var(--shadow-card)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
              {copy.eyebrow}
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--cc-text)]">
              {copy.title}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {copy.body}
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--cc-text)]">
              {copy.checklist.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span aria-hidden className="mt-2 size-1.5 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Show the report inline on small screens (the left column is hidden). */}
          <div className="lg:hidden">
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-border bg-background p-4 text-xs leading-6 text-foreground">
              {job.input_text ?? ""}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setStarting(true);
                onRun();
              }}
              disabled={starting}
              aria-busy={starting}
              className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-primary px-6 py-3 text-sm font-semibold text-white shadow-[var(--cc-glow)] transition-colors hover:bg-[#5741d8] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              {starting ? (
                "Starting…"
              ) : (
                <>
                  <RunIcon />
                  Run audit walkthrough
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onSkipToResults}
              disabled={starting}
              className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              Skip to final results
            </button>
            <p className="text-[11px] text-[var(--cc-text-muted)]">
              No API key needed. Watch the live reasoning replay, or skip straight to the finished audit.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function RunIcon() {
  return (
    <svg width="13" height="14" viewBox="0 0 11 12" fill="currentColor" aria-hidden className="shrink-0">
      <path d="M1 1.2v9.6a.6.6 0 0 0 .92.5l7.7-4.8a.6.6 0 0 0 0-1l-7.7-4.8A.6.6 0 0 0 1 1.2Z" />
    </svg>
  );
}

function ColumnResizeHandle({
  anchor,
  position,
  ariaLabel,
  onDelta,
  onKeyStep,
}: {
  anchor: "left" | "right";
  position: string;
  ariaLabel: string;
  onDelta: (dx: number) => void;
  onKeyStep: (dir: 1 | -1) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastX.current;
    lastX.current = e.clientX;
    if (dx !== 0) onDelta(dx);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); onKeyStep(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onKeyStep(1); }
  };

  // The 8px-wide hit area is centred on the column boundary; the 1px visible
  // rule sits at its centre and brightens to the brand purple on hover/drag.
  const centring = anchor === "left" ? "-translate-x-1/2" : "translate-x-1/2";
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      style={{ [anchor]: position, touchAction: "none" } as CSSProperties}
      className={`group absolute inset-y-0 z-20 hidden w-2 ${centring} cursor-col-resize lg:block focus-visible:outline-hidden`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--cc-border)] transition-colors group-hover:bg-primary group-focus-visible:bg-primary"
      />
    </div>
  );
}

/* ====================================================================== */
/*  AUDIT INPUT PAGE — clean form shown at /audit (no job id)             */
/* ====================================================================== */
function AuditInputPage() {
  const router = useRouter();
  const resetLive = useArgusStore((s) => s.resetLive);
  const clearStore = useArgusStore((s) => s.clear);
  const [apiKey, setApiKey] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "pdf">("text");
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState<"upload" | "sample" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hand off to the demo page, which loads the fixture and shows the idle
  // "report + Run" screen (playback starts on the Run click, not here).
  const trySample = () => {
    setLoading("sample");
    setError(null);
    clearStore();
    router.push("/audit?demo=1");
  };

  const prepareSampleLink = () => {
    setError(null);
    clearStore();
  };

  const onSubmitText = async () => {
    if (!apiKey.trim()) { setError("Please paste your MiroMind API key first."); return; }
    if (textInput.trim().length < 50) { setError("Text must be at least 50 characters."); return; }
    setLoading("upload");
    setError(null);
    try {
      const { job_id } = await submitText(textInput, apiKey);
      resetLive();
      router.push(`/audit?id=${encodeURIComponent(job_id)}&mode=text`);
    } catch (e) {
      if (e instanceof ArgusApiError) setError(`API error: ${e.message}`);
      else if (e instanceof Error) setError(`Could not reach the Argus API. (${e.message})`);
      else setError(String(e));
      setLoading(null);
    }
  };

  const onPicked = async (file: File) => {
    const looksLikePdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!looksLikePdf) {
      setError("Only PDF files are supported.");
      return;
    }
    if (!apiKey.trim()) { setError("Please paste your MiroMind API key first."); return; }
    setLoading("upload");
    setError(null);
    try {
      const { job_id } = await uploadPdf(file, apiKey);
      resetLive();
      router.push(`/audit?id=${encodeURIComponent(job_id)}`);
    } catch (e) {
      if (e instanceof UnsupportedMediaTypeError) setError("Only PDF files are supported.");
      else if (e instanceof ArgusApiError) setError(`API error: ${e.message}`);
      else if (e instanceof Error) setError(`Could not reach the Argus API. (${e.message})`);
      else setError(String(e));
      setLoading(null);
    }
  };

  return (
    <>
      <ArgusHeader
        rightSlot={
          <Link
            href="/audit?demo=1"
            onClick={prepareSampleLink}
            className="inline-flex items-center justify-center rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          >
            See a sample audit
          </Link>
        }
      />
      <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center px-6 py-14 md:py-20">
        <div className="w-full max-w-2xl">
          <div className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Audit AI-generated reports before sign-off
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Verify research, legal, and governance documents before they reach
              clients, regulators, or investment committees.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {["Investment research", "Legal & compliance", "AI governance"].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background p-6 shadow-[var(--shadow-card)]">
            <ApiKeyInput value={apiKey} onChange={setApiKey} />

            {/* Tab toggle */}
            <div className="mt-4 flex w-full rounded-lg border border-border bg-muted/50 p-0.5">
              <button
                type="button"
                onClick={() => { setInputMode("text"); setError(null); }}
                className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${inputMode === "text" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Paste Text
              </button>
              <button
                type="button"
                onClick={() => { setInputMode("pdf"); setError(null); }}
                className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${inputMode === "pdf" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Upload PDF
              </button>
            </div>

            {/* Text input */}
            {inputMode === "text" && (
              <div className="mt-4 flex flex-col gap-3">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={loading !== null}
                  placeholder="Paste an AI-generated research memo, legal note, compliance summary, or market analysis..."
                  className="h-48 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs ${
                      textInput.trim().length < 50 ? "text-warning-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {textInput.trim().length < 50
                      ? `${textInput.length.toLocaleString()} / 50 characters minimum`
                      : `${textInput.length.toLocaleString()} characters`}
                  </span>
                  <button
                    type="button"
                    onClick={onSubmitText}
                    disabled={loading !== null || textInput.trim().length < 50}
                    className="cursor-pointer rounded-[12px] bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#5741d8] disabled:pointer-events-none disabled:opacity-50"
                  >
                    {loading === "upload" ? "Submitting…" : "Run document audit →"}
                  </button>
                </div>
              </div>
            )}

            {/* PDF upload */}
            {inputMode === "pdf" && (
              <div className="mt-4">
                <PdfUploadDropzone
                  busy={loading === "upload"}
                  disabled={loading !== null}
                  onPicked={onPicked}
                />
              </div>
            )}

            {error && (
              <p role="alert" aria-live="assertive" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground">
                {error}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary-soft/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-medium text-foreground">No API key ready?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Open the legal filing demo and inspect the full audit workflow.
              </p>
            </div>
            <button
              type="button"
              onClick={trySample}
              disabled={loading !== null}
              className="inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted disabled:opacity-50"
            >
              {loading === "sample" ? "Loading…" : "See a sample audit"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
