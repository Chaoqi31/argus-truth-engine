"use client";

import { type CSSProperties, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useArgusStore } from "@/lib/store";
import { ArgusHeader } from "@/components/argus-header";
import { JobStatsBar } from "@/components/job-stats-bar";
import { FindingsTab } from "@/components/findings-tab";
import { EvidenceTab } from "@/components/evidence-tab";
import { TraceStreamView } from "@/components/trace-stream-view";
import { ShortcutsHint } from "@/components/shortcuts-hint";
import { ScenarioBanner } from "@/components/scenario-banner";
import { ExportMenu, type ExportFormat } from "@/components/export-menu";
import { useFindingKeyboardNav } from "@/lib/use-keyboard-nav";
import { buildAuditPackMarkdown, buildEvidenceStationJson } from "@/lib/audit-pack";
import { sortFindingsForReview } from "@/lib/findings";
import { TextViewer } from "@/components/text-viewer";
import { ClaimReviewPanel } from "@/components/claim-review-panel";
import { FindingDrawer } from "@/components/cockpit/finding-drawer";
import { CommandPalette } from "@/components/cockpit/command-palette";
import { EvidenceDiff } from "@/components/cockpit/evidence-diff";
import { DemoRunControls } from "@/components/demo-run-controls";
import type { Scenario } from "@/lib/load-job";
import { useAuthSession } from "@/lib/use-auth-session";
import { AuthButton } from "@/components/auth-button";
import { useAuditRun } from "./hooks/use-audit-run";
import { useDemoReplay } from "./hooks/use-demo-replay";
import {
  auditNextFromParams,
  clampPx,
  COCKPIT_CONSOLE_DEFAULT,
  COCKPIT_CONSOLE_MAX,
  COCKPIT_CONSOLE_MIN,
  COCKPIT_DOC_DEFAULT,
  COCKPIT_DOC_MAX,
  COCKPIT_DOC_MIN,
  DEMO_START_LINK,
  downloadText,
} from "./lib/constants";
import {
  getAuthUserLabel,
  PaletteHint,
  ShareAuditButton,
  SignedInNotice,
  useCommandPaletteHotkey,
} from "./components/audit-chrome";
import { AuditInputPage } from "./components/audit-input-page";
import { ColumnResizeHandle, ConsoleToggle } from "./components/cockpit-chrome";
import { DemoIdleScreen } from "./components/demo-idle-screen";
import { LiveFindingsList } from "./components/live-findings-list";
import { RunBanner } from "./components/run-banner";
import { VerdictHero } from "./components/verdict-hero";

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

export function AuditPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const paramsString = params.toString();
  const liveId = params.get("id");
  const demo = params.get("demo");
  const currentAuditNext = auditNextFromParams(paramsString);
  const auth = useAuthSession();

  const job = useArgusStore((s) => s.job);
  const activeFindingId = useArgusStore((s) => s.activeFindingId);
  const setActiveFinding = useArgusStore((s) => s.setActiveFinding);
  const setDrawerFinding = useArgusStore((s) => s.setDrawerFinding);
  const liveSteps = useArgusStore((s) => s.liveSteps);
  const liveFindings = useArgusStore((s) => s.liveFindings);
  const liveHeartbeat = useArgusStore((s) => s.liveHeartbeat);
  const runStatus = useArgusStore((s) => s.runStatus);
  const runError = useArgusStore((s) => s.runError);
  const findingReviews = useArgusStore((s) => s.findingReviews);
  const consoleMode = useArgusStore((s) => s.consoleMode);
  const setConsoleMode = useArgusStore((s) => s.setConsoleMode);

  const [hintOpen, setHintOpen] = useState(false);
  const [docW, setDocW] = useState(COCKPIT_DOC_DEFAULT);
  const [consoleW, setConsoleW] = useState(COCKPIT_CONSOLE_DEFAULT);
  const [showSignedInNotice, setShowSignedInNotice] = useState(false);
  const [scenario, setScenario] = useState<Scenario>(() =>
    params.get("scenario") === "nvidia" ? "nvidia" : "legal",
  );

  useFindingKeyboardNav(() => setHintOpen((v) => !v));
  useCommandPaletteHotkey();
  useAuditRun(liveId, auth);

  const {
    demoJob,
    demoRunning,
    runDemo,
    replayDemo,
    finishDemoNow,
    startAuditingFromDemo,
  } = useDemoReplay({
    liveId,
    demo,
    job,
    scenario,
    setScenario,
    router,
  });

  useEffect(() => {
    const browserParams = new URLSearchParams(window.location.search);
    if (browserParams.get("signedIn") !== "1") return;
    const cleanNext = auditNextFromParams(browserParams.toString());
    window.history.replaceState(window.history.state, "", cleanNext);
    const showTimer = window.setTimeout(() => setShowSignedInNotice(true), 0);
    const hideTimer = window.setTimeout(() => setShowSignedInNotice(false), 5200);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  const signedInNotice = showSignedInNotice && (auth.loading || auth.user) ? (
    <SignedInNotice userLabel={auth.user ? getAuthUserLabel(auth.user) : null} />
  ) : null;

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

  const isTextMode = params.get("mode") === "text" || job?.input_mode === "text";

  if (demo && demoJob && !job && !demoRunning && runStatus === "idle") {
    return (
      <DemoIdleScreen
        job={demoJob}
        onRun={runDemo}
        onSkipToResults={finishDemoNow}
        scenario={scenario}
        onScenarioChange={setScenario}
        signedInNotice={signedInNotice}
      />
    );
  }

  if ((liveId || demoRunning) && !job) {
    const lastStep = liveSteps[liveSteps.length - 1] ?? null;
    const lastAgent =
      lastStep?.content && typeof lastStep.content === "object" && lastStep.content !== null
        ? String((lastStep.content as Record<string, unknown>).agent ?? "")
        : "";
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
              <AuthButton next={currentAuditNext} />
            </div>
          }
        />
        {signedInNotice}
        <RunBanner
          runStatus={runStatus}
          steps={liveSteps.length}
          findings={liveFindings.length}
          reason={runError}
          activeAgent={lastAgent}
          heartbeat={liveHeartbeat}
        />
        <main className={`grid h-[calc(100vh-3.5rem-3rem)] grid-cols-1 grid-rows-1 ${splitGrid ? "md:grid-cols-[1fr_440px] lg:grid-cols-[1fr_480px]" : "lg:grid-cols-[minmax(0,1fr)_400px]"}`}>
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
          {runStatus === "reviewing" && liveId ? (
            <aside className="flex min-h-0 flex-col border-l border-[var(--cc-border)]">
              <ClaimReviewPanel jobId={liveId} />
            </aside>
          ) : splitGrid ? (
            <aside className="flex min-h-0 flex-col border-l border-[var(--cc-border)]">
              <div className="min-h-0 flex-1 border-b border-[var(--cc-border)]">
                <TraceStreamView job={null} liveMode liveSteps={liveSteps} />
              </div>
              <div className="max-h-[30vh] shrink-0 overflow-hidden">
                <div className="flex items-center gap-1 border-b border-[var(--cc-border)] bg-muted px-3 py-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Live findings preview
                  </span>
                </div>
                <LiveFindingsList findings={liveFindings} mode="stacked" />
              </div>
            </aside>
          ) : (
            <>
              <section className="min-h-0">
                <TraceStreamView job={null} liveMode liveSteps={liveSteps} />
              </section>
              <aside className="hidden min-h-0 flex-col border-l border-[var(--cc-border)] lg:flex">
                <div className="flex items-center gap-1 border-b border-[var(--cc-border)] bg-muted px-3 py-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Live findings preview
                  </span>
                </div>
                <LiveFindingsList findings={liveFindings} mode="side" />
              </aside>
            </>
          )}
        </main>
        <ShortcutsHint open={hintOpen} onClose={() => setHintOpen(false)} />
        <CommandPalette />
      </div>
    );
  }

  if (!liveId && !demo) {
    return <AuditInputPage signedInNotice={signedInNotice} />;
  }

  if (!job) return null;

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
                className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-[transform,border-color,background-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-primary/12 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 hover:border-primary/35 hover:bg-background hover:text-primary hover:shadow-[0_14px_32px_rgba(16,24,40,0.11)] hover:before:translate-x-[430%] hover:before:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden"
                aria-label="Replay the demo audit"
              >
                <span aria-hidden className="relative transition-transform duration-300 ease-enter group-hover:-rotate-45 motion-reduce:transform-none">↻</span>
                <span className="relative">Replay</span>
              </button>
            )}
            {demo === "1" && (
              <Link href="/audit" onClick={startAuditingFromDemo} className={DEMO_START_LINK}>
                Start auditing
              </Link>
            )}
            <PaletteHint />
            {liveId && auth.user && (
              <ShareAuditButton jobId={job.id} accessToken={auth.accessToken} />
            )}
            <ExportMenu onSelect={onExport} disabled={runStatus !== "done"} />
            <AuthButton next={currentAuditNext} />
          </div>
        }
      />
      {signedInNotice}
      {demo === "1" && job?.scenario_label && job?.persona && (
        <ScenarioBanner label={job.scenario_label} persona={job.persona} />
      )}
      <VerdictHero job={job} onStartReasoningWalkthrough={startReasoningWalkthrough} />
      <JobStatsBar job={job} />
      <main
        className="relative grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px] lg:[grid-template-columns:var(--cc-doc-w)_minmax(0,1fr)_var(--cc-console-w)]"
        style={{ "--cc-doc-w": `${docW}px`, "--cc-console-w": `${consoleW}px` } as CSSProperties}
      >
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

      <FindingDrawer />
      <CommandPalette />
      <EvidenceDiff />
    </div>
  );
}
