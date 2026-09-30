"use client";

import { useEffect, useRef, useState } from "react";
import type { Finding, Job, Stage, Step, VerificationStep } from "@/lib/types";
import { stepIcon, verdictTone } from "@/lib/colors";
import { useArgusStore } from "@/lib/store";
import { isDerivedFinding, sortFindingsForReview } from "@/lib/findings";
import { METRIC_LABEL, STAGE_BLURB, stageLabel } from "@/lib/stage-vocabulary";

// Verdict badge tints — keyed by the tone from `verdictTone`. Mirror the
// severity-tint pattern (text-foreground on a /15 surface) so contrast holds.
const TONE_BADGE: Record<string, string> = {
  ok: "bg-success/15 text-success",
  danger: "bg-destructive/15 text-destructive-foreground",
  warn: "bg-warning/15 text-warning-foreground",
  muted: "bg-muted text-muted-foreground",
};

interface Props {
  job: Job | null;
  activeFindingId?: string | null;
}

export function TraceStreamView({ job, activeFindingId = null }: Props) {
  return <StaticReplay job={job} activeFindingId={activeFindingId} />;
}

interface ClaimGroup {
  finding: Finding;
  claimText: string;
  steps: Step[];
}

// Which engine runs each pipeline stage. Only Verify touches MiroMind; the
// rest run on the cheap LLM or are deterministic. Badge tints follow the same
// /15-surface pattern as verdicts.
const ENGINE_BADGE: Record<Stage["engine"], { label: string; cls: string }> = {
  miromind: { label: "★ MiroMind", cls: "bg-primary/15 text-primary" },
  deepseek: { label: "DeepSeek", cls: "bg-muted text-muted-foreground" },
  deterministic: { label: "deterministic", cls: "bg-muted text-muted-foreground" },
};

function StaticReplay({ job, activeFindingId }: { job: Job | null; activeFindingId: string | null }) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceStageKey, setWorkspaceStageKey] = useState("verify");
  const highlightedStepId = useArgusStore((s) => s.highlightedStepId);

  if (!job) {
    return (
      <div className="flex h-full items-center justify-center px-3 text-xs text-muted-foreground">
        No job loaded.
      </div>
    );
  }

  // The per-claim MiroMind traces that nest under the Verify stage.
  const claimText = new Map(job.claims.map((c) => [c.id, c.text]));
  const traceById = new Map(job.traces.map((t) => [t.id, t]));
  const groups: ClaimGroup[] = sortFindingsForReview(
    job.findings.filter((f) => f.agent === "verifier"),
  )
    .map((f) => {
      const trace = traceById.get(f.reasoning_trace_id);
      const steps = trace ? trace.steps : [];
      return { finding: f, claimText: claimText.get(f.claim_id) ?? f.summary, steps };
    })
    .filter((g) => g.steps.length > 0);

  const totalSearches = groups.reduce(
    (n, g) => n + g.steps.filter((s) => s.type === "web_search").length,
    0,
  );
  const selectedFinding =
    activeFindingId !== null ? job.findings.find((f) => f.id === activeFindingId) ?? null : null;
  const selectedGroup =
    activeFindingId !== null ? groups.find((g) => g.finding.id === activeFindingId) ?? null : null;
  const fallbackGroup = selectedFinding ? null : groups[0] ?? null;
  const focusClaimText = selectedFinding
    ? claimText.get(selectedFinding.claim_id) ?? selectedFinding.summary
    : "";

  // Persisted per-stage summary when present; otherwise derive a thinner view
  // from the job so older fixtures/jobs still render every stage.
  const stages = job.stages;

  if (stages.length === 0 && groups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span aria-hidden className="text-2xl">🔍</span>
        <p className="text-sm font-medium">No reasoning trace recorded</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Start a live audit with your own PDF to watch every web search, reasoning step, and
          tool call stream in real time.
        </p>
      </div>
    );
  }

  const openWorkspace = (stageKey = "verify") => {
    setWorkspaceStageKey(stageKey);
    setWorkspaceOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <span className="block text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Reasoning walkthrough
          </span>
          <span className="block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
            {stages.length} stages · {totalSearches} web searches
          </span>
        </div>
        <button
          type="button"
          onClick={() => openWorkspace("verify")}
          className="shrink-0 rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        >
          Open full trace
        </button>
      </div>
      {selectedGroup ? (
        <ReasoningFocus group={selectedGroup} />
      ) : selectedFinding ? (
        <SelectedFindingTraceNotice finding={selectedFinding} claimText={focusClaimText} />
      ) : fallbackGroup ? (
        <ReasoningFocus group={fallbackGroup} />
      ) : null}
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="border-b border-border bg-muted/20 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Stage overview
        </div>
        <ol className="flex flex-col">
          {stages.map((s, i) => (
            <StageOverviewItem
              key={s.key}
              index={i + 1}
              stage={s}
              active={s.key === "verify" && selectedGroup !== null}
              onOpen={() => openWorkspace(s.key)}
            />
          ))}
        </ol>
      </div>
      {workspaceOpen && (
        <TraceWorkspace
          key={`${activeFindingId ?? "none"}-${workspaceStageKey}`}
          job={job}
          stages={stages}
          groups={groups}
          initialStageKey={workspaceStageKey}
          activeFindingId={activeFindingId}
          highlightedStepId={highlightedStepId}
          onClose={() => setWorkspaceOpen(false)}
        />
      )}
    </div>
  );
}

function StageOverviewItem({
  index,
  stage,
  active,
  onOpen,
}: {
  index: number;
  stage: Stage;
  active: boolean;
  onOpen: () => void;
}) {
  const badge = ENGINE_BADGE[stage.engine] ?? ENGINE_BADGE.deterministic;
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${
          active ? "bg-primary/5" : ""
        }`}
      >
        <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground">
          {index}
        </span>
        <span className="min-w-0 truncate text-xs font-semibold text-foreground">
          {stageLabel(stage.key)}
        </span>
        <span className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="col-start-2 col-end-4 min-w-0 truncate text-[11px] text-muted-foreground">
          {stage.summary}
        </span>
      </button>
    </li>
  );
}

function TraceWorkspace({
  job,
  stages,
  groups,
  initialStageKey,
  activeFindingId,
  highlightedStepId,
  onClose,
}: {
  job: Job;
  stages: Stage[];
  groups: ClaimGroup[];
  initialStageKey: string;
  activeFindingId: string | null;
  highlightedStepId: string | null;
  onClose: () => void;
}) {
  const activeGroup =
    activeFindingId !== null ? groups.find((g) => g.finding.id === activeFindingId) ?? null : null;
  const [stageKey, setStageKey] = useState(initialStageKey);
  const [selectedFindingId, setSelectedFindingId] = useState(
    activeGroup?.finding.id ?? groups[0]?.finding.id ?? null,
  );
  const selectedStage = stages.find((stage) => stage.key === stageKey) ?? stages[0] ?? null;
  const selectedGroup =
    selectedFindingId !== null
      ? groups.find((group) => group.finding.id === selectedFindingId) ?? null
      : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stageContentKey = selectedStage?.key ?? "none";

  return (
    <div className="trace-workspace-shell fixed inset-0 z-50 text-foreground shadow-[var(--shadow-card-hover)]">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border/80 bg-background/95 px-5 py-3 shadow-[0_1px_0_rgba(113,50,245,0.04)]">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Full trace workspace
            </p>
            <h2 className="truncate text-base font-semibold">
              Pipeline reasoning · {stages.length} stages · {groups.length} verified claims
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          >
            Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(320px,0.85fr)_minmax(460px,1.15fr)] gap-3 p-3">
          <aside className="trace-workspace-surface min-h-0 overflow-y-auto rounded-[14px] border border-border/80 shadow-[0_12px_36px_rgba(16,24,40,0.07)]">
            <div className="border-b border-border/70 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Stages
              </p>
            </div>
            <ol className="space-y-1 p-2">
              {stages.map((stage, index) => {
                const badge = ENGINE_BADGE[stage.engine] ?? ENGINE_BADGE.deterministic;
                const active = selectedStage?.key === stage.key;
                return (
                  <li key={stage.key}>
                    <button
                      type="button"
                      onClick={() => setStageKey(stage.key)}
                      aria-pressed={active}
                      className={`group relative w-full overflow-hidden rounded-[10px] px-3 py-3 text-left transition-[transform,background-color,box-shadow,color] duration-300 ease-enter hover:-translate-y-0.5 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset motion-reduce:transform-none motion-reduce:transition-none ${
                        active ? "bg-primary/10 text-primary shadow-[0_10px_28px_rgba(113,50,245,0.12)]" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-[transform,opacity] duration-300 ease-enter ${
                          active ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0 group-hover:scale-y-75 group-hover:opacity-40"
                        }`}
                      />
                      <div className="flex items-center gap-2">
                        <span className={`w-5 font-mono text-[10px] ${active ? "text-primary" : "text-muted-foreground"}`}>
                          {index + 1}
                        </span>
                        <span className={`min-w-0 flex-1 truncate text-xs font-semibold ${active ? "text-foreground" : ""}`}>
                          {stageLabel(stage.key)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 pl-7">
                        <span className={`rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium transition-transform duration-300 ease-enter group-hover:scale-105 motion-reduce:transform-none ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          {selectedStage?.key === "verify" ? (
            <>
              <section
                key={`${stageContentKey}-claims`}
                className="trace-panel-enter trace-workspace-surface min-h-0 overflow-y-auto rounded-[14px] border border-border/80 shadow-[0_12px_36px_rgba(16,24,40,0.07)]"
              >
                <VerifyClaimList
                  groups={groups}
                  selectedFindingId={selectedFindingId}
                  onSelect={setSelectedFindingId}
                />
              </section>
              <section
                key={`${stageContentKey}-detail`}
                className="trace-panel-enter trace-workspace-surface min-h-0 overflow-y-auto rounded-[14px] border border-border/80 shadow-[0_12px_36px_rgba(16,24,40,0.07)]"
              >
                {selectedGroup ? (
                  <WorkspaceClaimDetail group={selectedGroup} highlightedStepId={highlightedStepId} />
                ) : (
                  <div className="p-5 text-sm text-muted-foreground">
                    No verifier claim selected.
                  </div>
                )}
              </section>
            </>
          ) : selectedStage ? (
            <section
              key={stageContentKey}
              className="trace-panel-enter trace-workspace-surface col-span-2 min-h-0 overflow-y-auto rounded-[14px] border border-border/80 shadow-[0_12px_36px_rgba(16,24,40,0.07)]"
            >
              <StageDossier stage={selectedStage} job={job} groups={groups} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StageDossier({
  stage,
  job,
  groups,
}: {
  stage: Stage;
  job: Job;
  groups: ClaimGroup[];
}) {
  const badge = ENGINE_BADGE[stage.engine] ?? ENGINE_BADGE.deterministic;
  const ledger = stageLedger(stage, job, groups);

  return (
    <div className="w-full px-7 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-[6px] px-2 py-1 text-xs font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Stage dossier
        </span>
      </div>
      <h3 className="mt-2 text-lg font-semibold">{stageLabel(stage.key)}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {stage.summary}
      </p>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(280px,0.75fr)_minmax(520px,1.25fr)]">
        <aside className="space-y-4">
          <StageLedgerBlock ledger={ledger} />
          <MetricLedger metrics={stage.metrics ?? {}} />
        </aside>
        <StageDetail stage={stage} job={job} />
      </div>
    </div>
  );
}

interface StageLedgerInfo {
  input: string;
  output: string;
  transparency: string;
}

function stageLedger(stage: Stage, job: Job, groups: ClaimGroup[]): StageLedgerInfo {
  const claimCount = job.claims.length;
  const findingCount = job.findings.length;
  const evidenceCount = job.evidences.length;
  const verifiedCount = groups.length;
  const traceSteps = groups.reduce((n, group) => n + group.steps.length, 0);
  const searchCount = groups.reduce(
    (n, group) => n + group.steps.filter((step) => step.type === "web_search").length,
    0,
  );

  switch (stage.key) {
    case "parse":
      return {
        input: "Uploaded or pasted source text.",
        output: `${stage.metrics.pages ?? 1} page(s), ${stage.metrics.chars ?? 0} characters and text spans for highlighting.`,
        transparency: "Every later claim keeps a page/span pointer back to the original document.",
      };
    case "planner":
      return {
        input: "Parsed document text with domain hints.",
        output: `${claimCount} candidate factual claim(s) with claim type and importance metadata.`,
        transparency: "The candidate list shows exactly what Argus decided was worth checking.",
      };
    case "atomizer":
      return {
        input: `${stage.metrics.n_original ?? claimCount} original claim unit(s).`,
        output: `${stage.metrics.n_atoms ?? claimCount} atomic claim(s) for independent verification.`,
        transparency: "Compound assertions are split before research so one true subclaim cannot hide one false subclaim.",
      };
    case "checkworthiness":
      return {
        input: `${claimCount} extracted claim(s).`,
        output: `${stage.metrics.n_checkworthy ?? claimCount} check-worthy claim(s), ${stage.metrics.n_filtered ?? 0} filtered out.`,
        transparency: "Only externally verifiable factual statements move into paid research.",
      };
    case "shortlist":
      return {
        input: `${stage.metrics.n_before ?? claimCount} check-worthy claim(s).`,
        output: `${stage.metrics.n_after ?? verifiedCount} claim(s) queued for MiroMind verification.`,
        transparency: "The gate prevents low-value claims from consuming deep-research budget.",
      };
    case "skeptic":
      return {
        input: `${stage.metrics.n_reviewed ?? 0} high-risk verifier finding(s).`,
        output: `${stage.metrics.n_cleared ?? 0} cleared, ${stage.metrics.n_counterevidence_found ?? 0} with counterevidence, ${stage.metrics.n_inconclusive ?? 0} inconclusive.`,
        transparency: "High-risk verdicts get a second search path before confidence scoring.",
      };
    case "consistency":
      return {
        input: `${claimCount} claims and ${findingCount} finding(s).`,
        output: `${stage.metrics.n_findings ?? 0} cross-claim issue(s).`,
        transparency: "This catches contradictions and over-extensions that are not visible claim by claim.",
      };
    case "confidence":
      return {
        input: `${findingCount} finding(s), ${evidenceCount} source receipt(s), ${traceSteps} verifier trace step(s).`,
        output: `${stage.metrics.n_scored ?? findingCount} scored finding(s).`,
        transparency: "Scores are based on authority, freshness and source agreement rather than a single opaque percentage.",
      };
    case "reporter":
      return {
        input: `${findingCount} finding(s), ${evidenceCount} evidence receipt(s), ${searchCount} verifier search(es).`,
        output: job.audit_report_md ? "Executive summary generated." : "No executive summary generated.",
        transparency: "The report is a synthesis layer over the recorded findings, not a replacement for evidence and trace.",
      };
    default:
      return {
        input: "Previous pipeline stage output.",
        output: stage.summary,
        transparency: "The stage output is preserved so the audit path can be reviewed later.",
      };
  }
}

function StageLedgerBlock({ ledger }: { ledger: StageLedgerInfo }) {
  return (
    <div className="rounded-[12px] border border-border/80 bg-background px-4 py-4 shadow-[0_8px_28px_rgba(16,24,40,0.06)]">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Audit ledger
      </p>
      <dl className="mt-3 space-y-3">
        <StageLedgerRow label="Input" value={ledger.input} />
        <StageLedgerRow label="Output" value={ledger.output} />
        <StageLedgerRow label="Transparent because" value={ledger.transparency} />
      </dl>
    </div>
  );
}

function StageLedgerRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed text-foreground">{value}</dd>
    </div>
  );
}

function MetricLedger({ metrics }: { metrics: Record<string, number> }) {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-[12px] border border-border/80 bg-background px-4 py-4 shadow-[0_8px_28px_rgba(16,24,40,0.06)]">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Stage metrics
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-[10px] border border-primary/10 bg-primary/5 px-3 py-2">
            <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {value}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {METRIC_LABEL[key] ?? key}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerifyClaimList({
  groups,
  selectedFindingId,
  onSelect,
}: {
  groups: ClaimGroup[];
  selectedFindingId: string | null;
  onSelect: (findingId: string) => void;
}) {
  return (
    <div>
      <div className="border-b border-border/70 bg-[linear-gradient(180deg,rgba(113,50,245,0.045),transparent)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Verify claims
        </p>
      </div>
      <ol>
        {groups.map((group) => {
          const { finding, claimText, steps } = group;
          const selected = finding.id === selectedFindingId;
          const tone = verdictTone[finding.verdict] ?? "muted";
          const nSearch = steps.filter((step) => step.type === "web_search").length;
          return (
            <li key={finding.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(finding.id)}
                aria-pressed={selected}
                className={`w-full px-4 py-3 text-left transition-[background-color,box-shadow] duration-300 ease-enter hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${
                  selected ? "bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium capitalize ${TONE_BADGE[tone]}`}>
                    {finding.verdict}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {finding.evidence_ids.length} sources · {steps.length} steps · {nSearch} searches
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-3 text-xs font-medium leading-snug">
                  {claimText}
                </p>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function WorkspaceClaimDetail({
  group,
  highlightedStepId,
}: {
  group: ClaimGroup;
  highlightedStepId: string | null;
}) {
  const { finding, claimText, steps } = group;
  const nSearch = steps.filter((step) => step.type === "web_search").length;
  const nFetch = steps.filter((step) => step.type === "fetch_url_content").length;
  const tone = verdictTone[finding.verdict] ?? "muted";

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-border/70 bg-background px-5 py-4 shadow-[0_1px_0_rgba(113,50,245,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium capitalize ${TONE_BADGE[tone]}`}>
            {finding.verdict}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {finding.evidence_ids.length} sources · {steps.length} steps · {nSearch} searches
            {nFetch > 0 ? ` · ${nFetch} fetches` : ""}
          </span>
        </div>
        <p className="mt-2 text-sm font-semibold leading-snug">
          {claimText}
        </p>
      </div>

      <div key={finding.id} className="trace-panel-enter px-5 py-4">
        <VerdictBrief finding={finding} />
        <ol className="mt-4 flex flex-col gap-2">
          {steps.map((step) => (
            <StepItem key={step.id} step={step} highlighted={step.id === highlightedStepId} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function SelectedFindingTraceNotice({ finding, claimText }: { finding: Finding; claimText: string }) {
  const derived = isDerivedFinding(finding);
  const tone = verdictTone[finding.verdict] ?? "muted";

  return (
    <section className="border-b border-border bg-background px-3 py-3">
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Selected finding
          </span>
          <span className={`rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium capitalize ${TONE_BADGE[tone]}`}>
            {finding.verdict}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {derived ? "pipeline-derived" : "no saved trace"}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug text-foreground">
          {claimText}
        </p>
        <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
          {derived
            ? "This finding was produced from pipeline outputs rather than a separate MiroMind verifier run. The full audit-stage trail is still available below."
            : "This finding does not have a saved per-claim MiroMind trace. The full audit-stage trail is still available below."}
        </p>
      </div>
    </section>
  );
}

function ReasoningFocus({ group }: { group: ClaimGroup }) {
  const { finding, claimText, steps } = group;
  const nSearch = steps.filter((s) => s.type === "web_search").length;
  const nFetch = steps.filter((s) => s.type === "fetch_url_content").length;
  const nSources = finding.evidence_ids.length;
  const nReasoning = finding.reasoning_chain?.length ?? 0;
  const tone = verdictTone[finding.verdict] ?? "muted";
  const proof = finding.why_wrong ?? finding.summary;

  return (
    <section className="border-b border-border bg-background px-3 py-3">
      <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
            Start here
          </span>
          <span className={`rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium capitalize ${TONE_BADGE[tone]}`}>
            {finding.verdict}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {nSources > 0
              ? `${nSources} ${pluralizeTraceMetric("source", nSources)}`
              : "trace-backed"}
            {nSearch > 0 ? ` · ${nSearch} ${pluralizeTraceMetric("search", nSearch)}` : ""}
            {nFetch > 0 ? ` · ${nFetch} ${pluralizeTraceMetric("fetch", nFetch)}` : ""}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug text-foreground">
          {claimText}
        </p>
        <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">What Argus proved: </span>
          {proof}
        </p>
        {finding.correct_information?.value && (
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Correct: </span>
            {finding.correct_information.value}
          </p>
        )}
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Open stages below: {nReasoning} {pluralizeTraceMetric("reasoning step", nReasoning)}
          {nSearch > 0 ? ` · ${nSearch} ${pluralizeTraceMetric("search", nSearch)}` : ""}
        </p>
      </div>
    </section>
  );
}

function StageDetail({ stage, job }: { stage: Stage; job: Job }) {
  const chips = Object.entries(stage.metrics ?? {});
  const consistencyFindings =
    stage.key === "consistency"
      ? job.findings.filter((f) => f.agent === "consistency")
      : [];
  const skepticFindings =
    stage.key === "skeptic"
      ? job.findings.filter((f) => f.agent === "verifier" && f.skeptic_review)
      : [];
  const confidenceFindings =
    stage.key === "confidence" ? sortFindingsForReview(job.findings) : [];
  return (
    <div className="flex flex-col gap-4 rounded-[12px] border border-primary/10 bg-[linear-gradient(180deg,#fff,rgba(113,50,245,0.035))] px-4 py-4 shadow-[0_8px_28px_rgba(16,24,40,0.06)]">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Detailed artifacts
        </p>
      </div>
      {STAGE_BLURB[stage.key] && (
        <p className="text-sm leading-relaxed text-muted-foreground">{STAGE_BLURB[stage.key]}</p>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-baseline gap-1 rounded-[6px] border border-primary/10 bg-background px-2 py-1 text-xs shadow-sm"
            >
              <span className="font-mono font-semibold tabular-nums text-foreground">{v}</span>
              <span className="text-muted-foreground">{METRIC_LABEL[k] ?? k}</span>
            </span>
          ))}
        </div>
      )}

      {stage.key === "parse" && (
        <DocumentExcerpt job={job} />
      )}

      {(stage.key === "planner" ||
        stage.key === "atomizer" ||
        stage.key === "checkworthiness" ||
        stage.key === "shortlist" ||
        stage.key === "review") &&
        job.claims.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {stage.key === "planner"
                ? "Candidate claims"
                : stage.key === "atomizer"
                  ? "Atomic claims"
                  : stage.key === "checkworthiness"
                    ? "Kept as check-worthy"
                    : stage.key === "shortlist"
                      ? "Shortlisted for review"
                      : "Selected for verification"}
            </p>
            <ul className="grid gap-2">
              {job.claims.map((c) => (
                <li
                  key={c.id}
                  className="rounded-[8px] border border-border/80 bg-background px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>{c.type}</span>
                    <span>page {c.page}</span>
                    <span>{c.importance}</span>
                  </div>
                  <p>{c.text}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

      {stage.key === "checkworthiness" &&
        stage.filtered_claims &&
        stage.filtered_claims.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {stage.filtered_claims.map((fc, i) => (
              <li
                key={fc.claim_id ?? i}
                className="rounded-[8px] border border-border/80 bg-background px-3 py-2 text-xs shadow-sm"
              >
                <p className="text-foreground line-clamp-2">{fc.text}</p>
                <p className="mt-0.5 text-muted-foreground">
                  <span aria-hidden>↳ </span>
                  {fc.reason}
                </p>
              </li>
            ))}
          </ul>
      )}

      {stage.key === "skeptic" && (
        skepticFindings.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {skepticFindings.map((f) => {
              const review = f.skeptic_review;
              if (!review) return null;
              return (
                <li
                  key={f.id}
                  className="rounded-[8px] border border-border/80 bg-background px-3 py-2 text-xs leading-relaxed shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-foreground">
                      {review.status.replaceAll("_", " ")}
                    </span>
                    {review.recommended_verdict && (
                      <span className="text-muted-foreground">
                        Recommended verdict: {review.recommended_verdict}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-foreground">{review.summary}</p>
                  {review.counterevidence.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                      {review.counterevidence.map((item, i) => (
                        <li key={`${f.id}-counter-${i}`}>
                          <span className="font-medium text-foreground">{item.source}</span>
                          {item.url ? ` (${item.url})` : ""}: {item.relevance || item.snippet}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            No findings required independent challenge.
          </p>
        )
      )}

      {stage.key === "consistency" && consistencyFindings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {consistencyFindings.map((f) => (
            <li
              key={f.id}
              className="rounded-[8px] border border-border/80 bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground shadow-sm"
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-foreground">
                {f.verdict}
              </span>
              <span className="ml-1.5">{f.summary}</span>
            </li>
          ))}
        </ul>
      )}

      {stage.key === "confidence" && (
        <ConfidenceStageArtifacts findings={confidenceFindings} />
      )}

      {stage.key === "reporter" && (
        <ReportStageArtifact report={job.audit_report_md} />
      )}
    </div>
  );
}

function DocumentExcerpt({ job }: { job: Job }) {
  const source =
    job.input_text?.trim() ||
    job.claims.map((claim) => claim.text).join("\n\n");

  if (!source) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        No document text was persisted for this run.
      </p>
    );
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Parsed text excerpt
      </p>
      <div className="mt-2 rounded-[6px] border border-border bg-background px-3 py-2">
        <p className="line-clamp-8 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {source}
        </p>
      </div>
    </div>
  );
}

function ConfidenceStageArtifacts({ findings }: { findings: Finding[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Each verdict is scored on source authority, evidence freshness and source agreement.
      </p>
      <ol className="grid gap-2">
        {findings.map((finding) => {
          const tone = verdictTone[finding.verdict] ?? "muted";
          const breakdown = finding.confidence_breakdown;
          return (
            <li
              key={finding.id}
              className="rounded-[6px] border border-border bg-background px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium capitalize ${TONE_BADGE[tone]}`}>
                  {finding.verdict}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {Math.round(finding.confidence * 100)}% confidence
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 leading-relaxed text-foreground">
                {finding.summary}
              </p>
              {breakdown && (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                  <ConfidenceFactor label="authority" value={breakdown.source_authority} />
                  <ConfidenceFactor label="freshness" value={breakdown.evidence_freshness} />
                  <ConfidenceFactor label="agreement" value={breakdown.source_agreement} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ConfidenceFactor({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded border border-border bg-muted/30 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      <span className="text-foreground">{Math.round(value * 100)}%</span> {label}
    </span>
  );
}

function ReportStageArtifact({ report }: { report: string | null }) {
  if (!report) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        No executive summary was generated for this run.
      </p>
    );
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Generated executive summary
      </p>
      <div className="mt-2 rounded-[6px] border border-border bg-background px-3 py-2">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {plainReportText(report)}
        </p>
      </div>
    </div>
  );
}

function plainReportText(report: string): string {
  return report
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function VerdictBrief({ finding }: { finding: Finding }) {
  const reasoning = (finding.reasoning_chain ?? [])
    .map((step) => reasoningBriefText(step))
    .filter(Boolean)
    .slice(0, 3);
  const hasBrief =
    Boolean(finding.summary) ||
    Boolean(finding.why_wrong) ||
    Boolean(finding.correct_information) ||
    reasoning.length > 0;

  if (!hasBrief) return null;

  return (
    <div className="border-t border-border/60 px-3 pb-1.5 pl-7 pt-2">
      <div className="min-w-0 rounded-md border border-border bg-background px-2.5 py-2 text-[11px] shadow-sm">
        <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
          Verdict brief
        </p>
        {finding.summary && (
          <p className="mt-1.5 line-clamp-3 leading-relaxed text-foreground">
            {finding.summary}
          </p>
        )}
        {finding.why_wrong && (
          <p className="mt-1.5 line-clamp-3 leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Why wrong: </span>
            {finding.why_wrong}
          </p>
        )}
        {finding.correct_information && (
          <p className="mt-1.5 line-clamp-3 leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Correct: </span>
            {finding.correct_information.value}
            {finding.correct_information.source && (
              <span className="text-foreground/80"> — {finding.correct_information.source}</span>
            )}
          </p>
        )}
        {reasoning.length > 0 && (
          <ol className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
            {reasoning.map((text, index) => (
              <li key={`${index}-${text}`} className="flex gap-1.5 leading-snug text-muted-foreground">
                <span className="mt-0.5 shrink-0 font-mono text-[10px] text-primary">
                  {index + 1}
                </span>
                <span className="line-clamp-2 min-w-0">{text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function reasoningBriefText(step: VerificationStep): string {
  return step.reasoning || step.observation;
}

function pluralizeTraceMetric(label: string, value: number): string {
  if (value === 1) return label;
  if (label.endsWith("ch")) return `${label}es`;
  return `${label}s`;
}

interface SearchHit {
  title: string;
  link: string;
  snippet?: string;
}

/**
 * Pull the real search results out of a web_search step. MiroMind's
 * `google_search` tool returns its payload as a JSON string under
 * `content.result` with an `organic` array of {title, link, snippet}.
 * Returns [] when the step has no captured result (e.g. the call's
 * `done` event never arrived) — we never invent links.
 */
export function parseSearchHits(content: Record<string, unknown>): SearchHit[] {
  const raw = content.result;
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const organic = (parsed as { organic?: unknown })?.organic;
  if (!Array.isArray(organic)) return [];
  return organic
    .filter((o): o is { link: string; title?: unknown; snippet?: unknown } =>
      Boolean(o) && typeof (o as { link?: unknown }).link === "string",
    )
    .map((o) => ({
      title: typeof o.title === "string" && o.title.trim() ? o.title : o.link,
      link: o.link,
      snippet: typeof o.snippet === "string" ? o.snippet : undefined,
    }));
}

export function displayableThought(raw: string | null, summary: string): string | null {
  if (!raw) return null;
  const thought = raw.trim();
  if (!thought || thought === summary.trim()) return null;
  if (looksLikeMachineJson(thought)) return null;
  return thought;
}

function looksLikeMachineJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("},") ||
    trimmed.startsWith("],")
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object") return true;
    } catch {
      /* fall through to structural heuristic */
    }
  }
  const keyMatches = trimmed.match(/"[\w-]+"\s*:/g)?.length ?? 0;
  const structuralMatches = trimmed.match(/[{}\[\],]/g)?.length ?? 0;
  return keyMatches >= 3 && structuralMatches >= 5;
}

function StepItem({ step, highlighted = false, streamIn = false }: { step: Step; highlighted?: boolean; streamIn?: boolean }) {
  const icon = stepIcon[step.type] ?? "⚙";
  const isSearch = step.type === "web_search";
  const isFetch = step.type === "fetch_url_content";
  const hits = isSearch ? parseSearchHits(step.content) : [];
  const content = step.content as Record<string, unknown>;
  const thought = displayableThought(
    typeof content?.thought === "string" ? content.thought : null,
    step.summary,
  );
  const hasThought = !!thought && !isSearch && !isFetch;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  return (
    <li
      ref={ref}
      className={`flex flex-col gap-1 rounded-[6px] text-xs ${streamIn ? "animate-row-in" : ""} ${highlighted ? "-mx-1.5 bg-primary/10 px-1.5 py-1 ring-1 ring-primary/40" : ""}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          {isSearch ? (
            <span className="text-foreground">
              <span className="text-muted-foreground">search </span>
              <span className="font-medium">{step.summary.replace(/^search:\s*/i, "")}</span>
              {hits.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOpen((o) => !o)}
                  aria-expanded={open}
                  className="ml-2 whitespace-nowrap font-mono text-[10px] uppercase tracking-wider text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {open ? "▾" : "▸"} {hits.length} result{hits.length > 1 ? "s" : ""}
                </button>
              )}
            </span>
          ) : isFetch ? (
            <span className="text-foreground">
              <span className="text-muted-foreground">fetch </span>
              <span className="break-all font-mono text-primary/80">{step.summary.replace(/^fetch:\s*/i, "")}</span>
            </span>
          ) : hasThought ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="text-left text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span aria-hidden className="mr-1 font-mono text-[10px] text-muted-foreground">{open ? "▾" : "▸"}</span>
              {step.summary}
            </button>
          ) : (
            <span className="text-muted-foreground">{step.summary}</span>
          )}
        </div>
      </div>
      {isSearch && open && hits.length > 0 && (
        <ul className="ml-6 flex max-h-48 flex-col gap-1.5 overflow-y-auto border-l border-border pl-3 pr-2">
          {hits.map((h, i) => (
            <li key={`${h.link}-${i}`} className="min-w-0">
              <a
                href={h.link}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-medium text-primary hover:underline"
                title={h.title}
              >
                {h.title}
              </a>
              {h.snippet && (
                <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{h.snippet}</p>
              )}
              <span className="block truncate font-mono text-[10px] text-muted-foreground/70">{h.link}</span>
            </li>
          ))}
        </ul>
      )}
      {hasThought && open && (
        <div className="ml-6 border-l border-border pl-3">
          <p className="whitespace-pre-wrap font-mono text-[11px] leading-snug text-foreground/80">{thought}</p>
        </div>
      )}
    </li>
  );
}
