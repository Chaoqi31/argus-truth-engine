"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useArgusStore, type ConsoleMode } from "@/lib/store";
import { ArgusHeader } from "@/components/argus-header";
import { JobStatsBar } from "@/components/job-stats-bar";
import { FindingsTab } from "@/components/findings-tab";
import { EvidenceTab } from "@/components/evidence-tab";
import { TraceStreamView } from "@/components/trace-stream-view";
import { DagTab } from "@/components/dag-tab";
import { ShortcutsHint } from "@/components/shortcuts-hint";
import { ScenarioBanner } from "@/components/scenario-banner";
import { ExportMenu, type ExportFormat } from "@/components/export-menu";
import { ApiKeyInput } from "@/components/api-key-input";
import { useFindingKeyboardNav } from "@/lib/use-keyboard-nav";
import { subscribeTrace } from "@/lib/trace-ws";
import {
  getJob,
  downloadReport,
  uploadPdf,
  submitText,
  UnsupportedMediaTypeError,
  ArgusApiError,
  type ContentDomain,
} from "@/lib/api";
import { loadSampleJob } from "@/lib/load-job";
import { replayTrace } from "@/lib/trace-replayer";
import type { FilteredClaim, Finding, Job, LiveFinding, ReviewClaim, RunStatus, Step } from "@/lib/types";
import { TextViewer } from "@/components/text-viewer";
import { ClaimReviewPanel } from "@/components/claim-review-panel";
import { FindingDrawer } from "@/components/cockpit/finding-drawer";
import { CommandPalette } from "@/components/cockpit/command-palette";
import { EvidenceDiff } from "@/components/cockpit/evidence-diff";
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
  const setJob = useArgusStore((s) => s.setJob);
  const appendLiveStep = useArgusStore((s) => s.appendLiveStep);
  const appendLiveFinding = useArgusStore((s) => s.appendLiveFinding);
  const setRunStatus = useArgusStore((s) => s.setRunStatus);
  const resetLive = useArgusStore((s) => s.resetLive);
  const setReviewReady = useArgusStore((s) => s.setReviewReady);

  const consoleMode = useArgusStore((s) => s.consoleMode);
  const setConsoleMode = useArgusStore((s) => s.setConsoleMode);
  const [hintOpen, setHintOpen] = useState(false);

  // Demo playback: the fixture is loaded but HELD (not pushed to the store) so
  // we can show an idle "input + Run" screen first, then stream it through the
  // live UI on click. `demoRunning` flips on once playback starts.
  const [demoJob, setDemoJob] = useState<Job | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const demoAbortRef = useRef<AbortController | null>(null);

  useFindingKeyboardNav(() => setHintOpen((v) => !v));
  useCommandPaletteHotkey();

  const onExport = async (fmt: ExportFormat) => {
    if (!liveId) return;
    if (fmt === "pdf") {
      const blob = await downloadReport(liveId, null);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `argus-audit-${liveId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (fmt === "json") {
      const blob = new Blob([JSON.stringify(job, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `argus-audit-${liveId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const md = job?.audit_report_md ?? "";
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `argus-audit-${liveId}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

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
              setConsoleMode("evidence");
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              setRunStatus("failed", `Could not load final job: ${msg}`);
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

  // Demo mode (/audit?demo=1): load the bundled fixture but HOLD it in local
  // state instead of pushing it straight to the store. This lets us render an
  // idle "report + Run" screen first; clicking Run replays the fixture through
  // the live UI (see runDemo). Hitting the URL directly (share/refresh) still
  // works — it just lands on the idle screen rather than a blank page.
  useEffect(() => {
    if (liveId) return; // live mode owns the page
    if (job) return; // already running/finished
    if (!demo) return; // no demo → input UI (see AuditInputPage below)
    if (demoJob) return; // already loaded
    let cancelled = false;
    loadSampleJob()
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
  }, [liveId, demo, job, demoJob, router]);

  // Abort any in-flight demo playback if the page unmounts mid-stream.
  useEffect(() => () => demoAbortRef.current?.abort(), []);

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

    const steps = demoJob.traces
      .flatMap((t) => t.steps)
      .sort((a, b) => a.sequence - b.sequence);
    const findings = demoJob.findings;

    // A verdict only appears AFTER its claim's reasoning has fully streamed —
    // reveal finding k once the last step of its trace has been shown.
    const revealAt = findings.map((f) => {
      let last = 0;
      steps.forEach((s, i) => {
        if (s.trace_id === f.reasoning_trace_id) last = i + 1;
      });
      return last || steps.length;
    });
    const revealed = new Set<number>();
    let shown = 0;

    void replayTrace(
      steps,
      (step) => {
        appendLiveStep(step);
        shown += 1;
        findings.forEach((f, k) => {
          if (!revealed.has(k) && shown >= revealAt[k]) {
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

  const isTextMode = params.get("mode") === "text" || job?.input_mode === "text";

  // Demo idle screen: fixture loaded but not yet running — show the source
  // report + a single Run button. Clicking Run streams it through the live UI.
  if (demo && demoJob && !job && !demoRunning && runStatus === "idle") {
    return <DemoIdleScreen job={demoJob} onRun={runDemo} />;
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
    const tokensSoFar = liveSteps.reduce((sum, s) => {
      const t =
        s.content && typeof s.content === "object" && s.content !== null
          ? Number((s.content as Record<string, unknown>).total_tokens ?? 0)
          : 0;
      return sum + (Number.isFinite(t) ? t : 0);
    }, 0);
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
          tokens={tokensSoFar}
        />
        <main className={`grid h-[calc(100vh-3.5rem-3rem)] grid-cols-1 ${splitGrid ? "md:grid-cols-[1fr_440px] lg:grid-cols-[1fr_480px]" : ""}`}>
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
          <aside className="flex flex-col border-l border-[var(--cc-border)]">
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
                <div className="border-t border-[var(--cc-border)] h-[18rem] min-h-0 flex flex-col">
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

  // No live job, no demo, no existing job → show the input page
  if (!liveId && !demo && !job) {
    return <AuditInputPage />;
  }

  if (!job) return null;

  // Clicking a finding (card or document span): select it, open the detail
  // drawer, and surface its evidence in the right console (preserves PM-fix #4:
  // a click must visibly surface the receipts, not just thicken a border).
  const selectFinding = (id: string) => {
    setActiveFinding(id);
    setDrawerFinding(id);
    setConsoleMode("evidence");
  };

  const onClaimClick = (claimId: string) => {
    const f = job.findings.find((f) => f.claim_id === claimId);
    if (f) selectFinding(f.id);
  };

  const fileUrl = liveId ? `/api/argus/jobs/${encodeURIComponent(job.id)}/pdf` : "/sample-report.pdf";
  const jobIsText = job.input_mode === "text";

  // Reasoning DAG (Zone-3 "Graph") follows the active finding. Switching findings
  // re-derives this from activeFindingId, so the graph stays in sync.
  const activeFinding = job.findings.find((f) => f.id === activeFindingId);
  const activeTrace = job.traces.find((t) => t.id === activeFinding?.reasoning_trace_id) ?? null;

  return (
    <div className="cockpit cc-backdrop flex h-screen flex-col">
      <ArgusHeader
        rightSlot={
          <div className="flex items-center gap-2">
            <PaletteHint />
            <ExportMenu onSelect={onExport} disabled={runStatus !== "done"} />
          </div>
        }
      />
      {demo === "1" && job?.scenario_label && job?.persona && (
        <ScenarioBanner label={job.scenario_label} persona={job.persona} />
      )}
      <VerdictHero job={job} />
      <JobStatsBar job={job} />
      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_400px]">
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

        {/* Zone 2 — findings as premium cards */}
        <section className="flex min-h-0 flex-col border-[var(--cc-border)] lg:border-l">
          <div className="flex items-center gap-2 border-b border-[var(--cc-border)] bg-muted px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Findings
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {job.findings.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FindingsTab job={job} activeFindingId={activeFindingId} onSelect={selectFinding} />
          </div>
        </section>

        {/* Zone 3 — reasoning console (evidence / live trace / graph) */}
        <aside className="flex min-h-0 flex-col border-l border-[var(--cc-border)]">
          <div className="flex items-center gap-1 border-b border-[var(--cc-border)] bg-muted px-3 py-2">
            <ConsoleToggle current={consoleMode} onChange={setConsoleMode} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {consoleMode === "evidence" ? (
              <EvidenceTab job={job} findingId={activeFindingId} />
            ) : consoleMode === "trace" ? (
              <TraceStreamView job={job} />
            ) : (
              <DagTab trace={activeTrace} />
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
function VerdictHero({ job }: { job: Job }) {
  const reduceMotion = useReducedMotion();
  // Verdict bloom: fires when BlurText finishes resolving (blur→sharp). Flares
  // to 0.8 then decays like an afterglow to a resting 0.2 over ~1.5s. Under
  // reduced motion it just sits at a low constant tint (no flash).
  const [revealed, setRevealed] = useState(false);

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
  const toneColor: Record<typeof tone, string> = {
    danger: "var(--cc-danger)",
    warn: "var(--cc-warn)",
    ok: "var(--cc-ok)",
  };

  const subject = job.input_mode === "text" ? "this content" : "this report";
  let headline: string;
  if (issues === 0) {
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

  // Re-arm the bloom whenever the headline (and thus BlurText) remounts.
  useEffect(() => {
    setRevealed(false);
  }, [headline]);

  const counts: Array<{ n: number; label: string; color: string }> = [];
  if (sev.critical) counts.push({ n: sev.critical, label: "critical", color: "var(--cc-danger)" });
  if (sev.major) counts.push({ n: sev.major, label: "major", color: "var(--cc-warn)" });
  if (sev.minor) counts.push({ n: sev.minor, label: "minor", color: "var(--cc-text-muted)" });

  const glowColor = toneColor[tone];

  return (
    <section
      role="status"
      className="relative flex h-16 items-center gap-4 overflow-hidden border-b border-[var(--cc-border)] px-6"
    >
      {/* Verdict neon bloom behind the headline — synced to BlurText reveal.
          Large, heavily blurred radial gradient tinted by verdict tone. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute left-0 top-1/2 -z-0 h-[200%] w-[60%] -translate-y-1/2 rounded-full"
        style={{
          background: `radial-gradient(50% 60% at 28% 50%, color-mix(in oklab, ${glowColor} 55%, transparent) 0%, color-mix(in oklab, ${glowColor} 20%, transparent) 40%, transparent 72%)`,
          filter: "blur(40px)",
        }}
        initial={{ opacity: reduceMotion ? 0.2 : 0 }}
        animate={
          reduceMotion
            ? { opacity: 0.2 }
            : revealed
              ? { opacity: [0, 0.8, 0.2] }
              : { opacity: 0 }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 1.6, times: [0, 0.18, 1], ease: "easeOut" }
        }
      />
      <span
        aria-hidden
        className="cc-status-dot relative size-3 shrink-0 rounded-full"
        style={{ color: toneColor[tone], backgroundColor: toneColor[tone] }}
      />
      <div className="relative min-w-0 flex-1">
        <BlurText
          key={headline}
          text={headline}
          className="text-base font-bold tracking-tight text-[var(--cc-text)] md:text-lg"
          animateBy="words"
          delay={60}
          onAnimationComplete={() => setRevealed(true)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {issues === 0
            ? "No factual issues detected across the checked claims."
            : "Verdicts below link to external evidence and reasoning."}
        </p>
      </div>

      {counts.length > 0 && (
        <div className="hidden shrink-0 items-center gap-5 sm:flex">
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
              {job.claims.length}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {job.claims.length === 1 ? "claim" : "claims"}
            </span>
          </div>
        </div>
      )}
    </section>
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
  runStatus: RunStatus;
  steps: number;
  findings: number;
  reason: string | null;
  activeAgent?: string;
  tokens?: number;
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
        className="flex h-12 items-center gap-3 border-b border-[var(--cc-danger)]/40 bg-[var(--cc-danger)]/10 px-4 text-xs text-[var(--cc-danger)]"
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
      className="flex h-12 items-center gap-3 overflow-x-auto border-b border-[var(--cc-border)] bg-muted px-4 text-xs"
    >
      <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--cc-ok)]" />
      <span className="shrink-0 text-[var(--cc-text)]">
        Audit running… <strong>{steps}</strong> steps · <strong>{findings}</strong> findings
      </span>
      {activeAgent && (
        <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
          <span className="text-muted-foreground">last agent</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-[var(--cc-text)]">
            {activeAgent}
          </code>
        </span>
      )}
      {tokens !== undefined && tokens > 0 && (
        <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
          <span className="text-muted-foreground">tokens</span>
          <span className="font-mono tabular-nums text-[var(--cc-text)]">{tokens.toLocaleString()}</span>
          <span className="text-muted-foreground">· est</span>
          <span className="font-mono tabular-nums text-[var(--cc-text)]">${estCost.toFixed(2)}</span>
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
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
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
    { key: "graph", label: "Graph" },
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
function DemoIdleScreen({ job, onRun }: { job: Job; onRun: () => void }) {
  const [starting, setStarting] = useState(false);
  return (
    <div className="cockpit cc-backdrop min-h-screen">
      <ArgusHeader />
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
              Sample audit
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--cc-text)]">
              Audit this note
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Replays a completed audit of this note, step by step — every reasoning
              step, web search, and verdict, just as it streamed live.
            </p>
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
                  Run audit
                </>
              )}
            </button>
            <p className="text-[11px] text-[var(--cc-text-muted)]">
              No API key needed — replays a completed audit.
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

/* ====================================================================== */
/*  AUDIT INPUT PAGE — clean form shown at /audit (no job id)             */
/* ====================================================================== */
function AuditInputPage() {
  const router = useRouter();
  const resetLive = useArgusStore((s) => s.resetLive);
  const [apiKey, setApiKey] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "pdf">("text");
  const [textInput, setTextInput] = useState("");
  const [contentDomain, setContentDomain] = useState<ContentDomain>("general");
  const [loading, setLoading] = useState<"upload" | "sample" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hand off to the demo page, which loads the fixture and shows the idle
  // "report + Run" screen (playback starts on the Run click, not here).
  const trySample = () => {
    setLoading("sample");
    setError(null);
    resetLive();
    router.push("/audit?demo=1");
  };

  const onSubmitText = async () => {
    if (!apiKey.trim()) { setError("Please paste your MiroMind API key first."); return; }
    if (textInput.trim().length < 50) { setError("Text must be at least 50 characters."); return; }
    setLoading("upload");
    setError(null);
    try {
      const { job_id } = await submitText(textInput, apiKey, { contentDomain });
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
      <ArgusHeader />
      <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Start an audit</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Paste AI-generated content or upload a PDF to verify.
            </p>
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
                  placeholder="Paste LLM-generated content here (research report, article, analysis…)"
                  className="h-48 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <div className="flex items-center gap-2">
                  <label htmlFor="domain-select" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                    Content domain
                  </label>
                  <select
                    id="domain-select"
                    value={contentDomain}
                    onChange={(e) => setContentDomain(e.target.value as ContentDomain)}
                    disabled={loading !== null}
                    className="cursor-pointer rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                  >
                    <option value="general">General</option>
                    <option value="academic">Academic</option>
                    <option value="medical">Medical</option>
                    <option value="legal">Legal</option>
                    <option value="finance">Finance</option>
                    <option value="technology">Technology</option>
                    <option value="news">News</option>
                    <option value="science">Science</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{textInput.length.toLocaleString()} characters</span>
                  <button
                    type="button"
                    onClick={onSubmitText}
                    disabled={loading !== null || textInput.trim().length < 50}
                    className="cursor-pointer rounded-[12px] bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#5741d8] disabled:pointer-events-none disabled:opacity-50"
                  >
                    {loading === "upload" ? "Submitting…" : "Check for hallucinations →"}
                  </button>
                </div>
              </div>
            )}

            {/* PDF upload */}
            {inputMode === "pdf" && (
              <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border p-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-10 text-muted-foreground/50" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                <p className="text-sm text-muted-foreground">Drop a PDF here or click to browse</p>
                <label className={`cursor-pointer rounded-[12px] bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#5741d8] ${loading !== null ? "pointer-events-none opacity-50" : ""}`}>
                  {loading === "upload" ? "Uploading…" : "Select PDF"}
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={loading !== null}
                    className="sr-only"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onPicked(f); }}
                  />
                </label>
              </div>
            )}

            {error && (
              <p role="alert" aria-live="assertive" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground">
                {error}
              </p>
            )}
          </div>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={trySample}
              disabled={loading !== null}
              className="cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              {loading === "sample" ? "Loading…" : "…or try the sample audit (no key needed)"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
