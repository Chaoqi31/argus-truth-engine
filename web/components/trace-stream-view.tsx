"use client";

import { useEffect, useRef, useState } from "react";
import type { Finding, FindingReasoningStep, Job, Stage, Step } from "@/lib/types";
import { stepIcon, verdictTone } from "@/lib/colors";
import { useArgusStore } from "@/lib/store";
import { sortFindingsForReview } from "@/lib/findings";

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
  liveMode?: boolean;
  liveSteps?: Step[];
  activeFindingId?: string | null;
}

export function TraceStreamView({ job, liveMode = false, liveSteps = [], activeFindingId = null }: Props) {
  if (liveMode) return <LiveTrace steps={liveSteps} />;
  return <StaticReplay job={job} activeFindingId={activeFindingId} />;
}

function LiveTrace({ steps }: { steps: Step[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reviewClaims = useArgusStore((s) => s.reviewClaims);
  const heartbeat = useArgusStore((s) => s.liveHeartbeat);
  // Elapsed is wall-clock from when the first step lands client-side (state set
  // in an effect, not a ref read during render). Synthetic stage/claim markers
  // carry an empty created_at and the demo replays months-old fixture steps, so
  // the step's own timestamp cannot anchor the clock.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => {
    // One-time anchor when the first step lands — a real external signal, not
    // render-derived state. Same pattern as useCountUp's trigger.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (steps.length > 0 && startedAt === null) setStartedAt(Date.now());
  }, [steps.length, startedAt]);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [steps.length]);
  // Tick once per second for the elapsed clock. Must NOT depend on steps.length:
  // re-running on every streamed step clears the interval before it can fire,
  // which froze the clock for the entire run.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const claimMeta = new Map(
    reviewClaims.map(
      (c, i) => [c.id, { text: c.text, ordinal: `${i + 1}/${reviewClaims.length}` }] as const,
    ),
  );
  const groups = groupLiveSteps(steps, claimMeta);
  const currentClaim = [...groups].reverse().find((g) => g.type === "claim") ?? null;
  const totalSearches = steps.filter((s) => s.type === "web_search").length;
  const totalFetches = steps.filter((s) => s.type === "fetch_url_content").length;
  const sourceCount = steps.filter((s) => {
    const result = s.content?.result;
    return s.type === "web_search" && typeof result === "string" && result.includes("organic");
  }).length;
  const elapsed = startedAt !== null ? formatElapsed(now - startedAt) : "0s";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Live trace
          </span>
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success" />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {steps.length} steps
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <LiveChip label="searches" value={totalSearches} pop />
          <LiveChip label="fetches" value={totalFetches} pop />
          <LiveChip label="source sets" value={sourceCount} pop />
          <LiveChip label="elapsed" value={elapsed} />
        </div>
      </div>
      {currentClaim && (
        <div className="border-b border-border bg-background/95 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
            Verifying {currentClaim.ordinal ? `claim ${currentClaim.ordinal}` : "claim"}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-foreground">
            {currentClaim.label}
          </p>
          {heartbeat && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {heartbeat.message} {Math.round(heartbeat.elapsed_s)}s elapsed
            </p>
          )}
        </div>
      )}
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">Waiting for first step…</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {groups.map((g) => (
              <LiveGroupItem key={g.key} group={g} />
            ))}
            <li className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="frontier-dot size-1.5 rounded-full bg-primary" style={{ animationDelay: "0ms" }} />
              <span aria-hidden className="frontier-dot size-1.5 rounded-full bg-primary" style={{ animationDelay: "200ms" }} />
              <span aria-hidden className="frontier-dot size-1.5 rounded-full bg-primary" style={{ animationDelay: "400ms" }} />
              <span className="ml-1 font-mono text-[10px] uppercase tracking-wider">MiroMind is researching</span>
            </li>
          </ol>
        )}
      </div>
    </div>
  );
}

function LiveChip({ label, value, pop = false }: { label: string; value: string | number; pop?: boolean }) {
  return (
    <span className="rounded border border-border bg-background px-1.5 py-0.5">
      {pop ? (
        <span key={String(value)} className="chip-pop text-foreground">{value}</span>
      ) : (
        <span className="text-foreground">{value}</span>
      )}{" "}
      {label}
    </span>
  );
}

interface LiveStepGroup {
  key: string;
  type: "stage" | "claim" | "system";
  label: string;
  meta?: string;
  ordinal?: string;
  steps: Step[];
}

function groupLiveSteps(
  steps: Step[],
  claimMeta?: Map<string, { text: string; ordinal: string }>,
): LiveStepGroup[] {
  const groups: LiveStepGroup[] = [];
  let currentClaimKey: string | null = null;

  const pushClaim = (key: string, label: string, meta?: string, ordinal?: string) => {
    currentClaimKey = key;
    let group = groups.find((g) => g.key === key) ?? null;
    if (!group) {
      group = { key, type: "claim", label, meta, ordinal, steps: [] };
      groups.push(group);
    }
    return group;
  };

  for (const step of steps) {
    const content = step.content as Record<string, unknown>;
    const stage = content.__stage as
      | { name?: string; engine?: string; summary?: string }
      | undefined;
    if (stage) {
      currentClaimKey = null;
      groups.push({
        key: `stage-${step.id}`,
        type: "stage",
        label: stage.name ?? step.summary,
        meta: stage.summary ?? step.summary,
        steps: [step],
      });
      continue;
    }

    const claim = content.__claim as
      | { index?: number; total?: number; text?: string }
      | undefined;
    if (claim) {
      const ordinal =
        typeof claim.index === "number" && typeof claim.total === "number"
          ? `${claim.index}/${claim.total}`
          : undefined;
      pushClaim(
        `claim-marker-${step.id}`,
        claim.text ?? step.summary,
        "MiroMind deep research",
        ordinal,
      );
      continue;
    }

    const claimId = typeof content.claim_id === "string" ? content.claim_id : null;
    if (claimId) {
      const meta = claimMeta?.get(claimId);
      const group = pushClaim(
        `claim-${claimId}`,
        meta?.text ?? claimId,
        typeof content.agent === "string" ? content.agent : "MiroMind deep research",
        meta?.ordinal,
      );
      group.steps.push(step);
      continue;
    }

    const activeClaim = currentClaimKey
      ? groups.find((g) => g.key === currentClaimKey)
      : null;
    if (activeClaim) {
      activeClaim.steps.push(step);
    } else {
      let system = groups.find((g) => g.key === "system");
      if (!system) {
        system = { key: "system", type: "system", label: "Pipeline activity", steps: [] };
        groups.push(system);
      }
      system.steps.push(step);
    }
  }

  return groups.filter((g) => g.type !== "claim" || g.steps.length > 0 || g.label);
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function LiveGroupItem({ group }: { group: LiveStepGroup }) {
  if (group.type === "stage") {
    return (
      <li className="animate-row-in rounded-md border border-border bg-muted/30 px-2 py-1.5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-primary">{group.label}</p>
        {group.meta && <p className="mt-0.5 text-xs text-muted-foreground">{group.meta}</p>}
      </li>
    );
  }

  return (
    <li className="animate-row-in rounded-md border border-border bg-background">
      <div className="border-b border-border px-2.5 py-2">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-primary">
          <span>{group.type === "claim" ? "Claim" : "Pipeline"}</span>
          {group.ordinal && <span className="rounded bg-primary/10 px-1.5 py-0.5">{group.ordinal}</span>}
          {group.meta && <span className="text-muted-foreground">{group.meta}</span>}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-foreground">{group.label}</p>
      </div>
      {group.steps.length > 0 && (
        <ol className="flex flex-col gap-1 px-2.5 py-2">
          {group.steps.map((s) => (
            <StepItem key={s.id} step={s} streamIn />
          ))}
        </ol>
      )}
    </li>
  );
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

// Human-readable labels for the per-stage metric chips.
const METRIC_LABEL: Record<string, string> = {
  pages: "pages", chars: "chars",
  n_claims: "claims", n_original: "original", n_atoms: "atomic",
  n_checkworthy: "check-worthy", n_filtered: "filtered",
  n_before: "before", n_after: "after", n_verifying: "to verify",
  n_steps: "steps", n_searches: "web searches",
  n_findings: "findings", n_scored: "scored",
  n_reviewed: "reviewed", n_cleared: "cleared",
  n_counterevidence_found: "counterevidence", n_inconclusive: "inconclusive",
};

// One-line "what this step does" shown at the top of each expanded stage.
const STAGE_BLURB: Record<string, string> = {
  parse: "Extracts the raw text and character offsets from the document.",
  planner: "Reads the document and pulls out the discrete factual claims worth checking.",
  atomizer: "Splits compound claims into atomic, independently-verifiable statements.",
  checkworthiness: "Drops opinions, forecasts and trivia — keeps only checkable factual claims.",
  review_gate: "De-duplicates the claims and caps how many go to paid verification.",
  verify: "Runs each claim through MiroMind deep research — web searches, fetches, reasoning.",
  skeptic: "Independently challenges high-risk MiroMind verdicts by searching for counterevidence before confidence scoring.",
  consistency: "Checks the claims against each other for contradictions and unsupported leaps.",
  confidence: "Scores each verdict on source authority, evidence freshness and source agreement.",
  reporter: "Writes the executive summary of the audit.",
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
    job.findings.filter((f) => f.agent === "UnifiedVerifier"),
  )
    .map((f) => {
      const trace = traceById.get(f.reasoning_trace_id);
      const steps = trace
        ? [...trace.steps].sort((a, b) => a.sequence - b.sequence)
        : [];
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
  const stages: Stage[] = job.stages?.length ? job.stages : deriveStages(job, groups);

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
          {stage.name}
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
                          {stage.name}
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
      <h3 className="mt-2 text-lg font-semibold">{stage.name}</h3>
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
    case "review_gate":
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
  const derived = finding.agent !== "UnifiedVerifier";
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
      ? job.findings.filter((f) => f.agent === "Consistency")
      : [];
  const skepticFindings =
    stage.key === "skeptic"
      ? job.findings.filter((f) => f.agent === "UnifiedVerifier" && f.skeptic_review)
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
        stage.key === "review_gate") &&
        job.claims.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {stage.key === "planner"
                ? "Candidate claims"
                : stage.key === "atomizer"
                  ? "Atomic claims"
                  : stage.key === "checkworthiness"
                    ? "Kept as check-worthy"
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

      {stage.key === "planner" && stage.strategy && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Strategy: </span>
          {stage.strategy}
        </p>
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

function deriveStages(job: Job, groups: ClaimGroup[]): Stage[] {
  const nClaims = job.claims.length || groups.length;
  const nConsistency = job.findings.filter((f) => f.agent === "Consistency").length;
  const totalSteps = groups.reduce((n, g) => n + g.steps.length, 0);
  const totalSearches = groups.reduce(
    (n, g) => n + g.steps.filter((s) => s.type === "web_search").length,
    0,
  );
  const nAudited = job.claims_audited ?? groups.length;
  return [
    { key: "parse", name: "Parse", engine: "deterministic", summary: "Document → text + character offsets", metrics: {} },
    { key: "planner", name: "Planner", engine: "deepseek", summary: "Audit strategy & domain hints", metrics: { n_claims: nClaims } },
    { key: "atomizer", name: "Atomizer", engine: "deepseek", summary: `Normalised into ${nClaims} atomic claims`, metrics: { n_atoms: nClaims } },
    { key: "checkworthiness", name: "Check-worthiness", engine: "deepseek", summary: "Opinions & trivia filtered out", metrics: {} },
    { key: "review_gate", name: "Review gate", engine: "deterministic", summary: `${nClaims} claims selected to verify`, metrics: { n_verifying: nClaims } },
    { key: "verify", name: "Verify", engine: "miromind", summary: `Deep-researched ${nAudited} claim(s) · ${totalSteps} steps · ${totalSearches} web searches`, metrics: { n_claims: nAudited, n_steps: totalSteps, n_searches: totalSearches } },
    { key: "consistency", name: "Consistency", engine: "deepseek", summary: nConsistency ? `${nConsistency} cross-claim finding(s)` : "No contradictions found", metrics: { n_findings: nConsistency } },
    { key: "confidence", name: "Confidence", engine: "deterministic", summary: "Scored on 3 measured factors", metrics: {} },
    { key: "reporter", name: "Reporter", engine: "deepseek", summary: job.audit_report_md ? "Executive summary generated" : "—", metrics: {} },
  ];
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

function reasoningBriefText(step: FindingReasoningStep): string {
  if ("reasoning" in step && step.reasoning) return step.reasoning;
  if ("content" in step && step.content) return step.content;
  if ("observation" in step && step.observation) return step.observation;
  return "";
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

function StepItem({ step, highlighted = false, streamIn = false }: { step: Step; highlighted?: boolean; streamIn?: boolean }) {
  const icon = stepIcon[step.type] ?? "⚙";
  const isSearch = step.type === "web_search";
  const isFetch = step.type === "fetch_url_content";
  const hits = isSearch ? parseSearchHits(step.content) : [];
  const content = step.content as Record<string, unknown>;
  const stageMark = content.__stage as
    | { name: string; engine: Stage["engine"]; summary: string }
    | undefined;
  const claimMark = content.__claim as
    | { index: number; total: number; text: string }
    | undefined;
  const thought = typeof content?.thought === "string" ? content.thought : null;
  const hasThought = !!thought && !isSearch && !isFetch && thought.trim() !== step.summary.trim();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  // Pipeline-stage marker (live replay only) — a labelled stage line.
  if (stageMark) {
    const badge = ENGINE_BADGE[stageMark.engine] ?? ENGINE_BADGE.deterministic;
    return (
      <li className="mt-1 flex items-center gap-2 border-t border-border/60 pt-2 text-xs first:mt-0 first:border-t-0 first:pt-0">
        <span className="shrink-0 font-semibold text-foreground">{stageMark.name}</span>
        <span className={`shrink-0 rounded-[5px] px-1.5 py-0.5 text-[9px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{stageMark.summary}</span>
      </li>
    );
  }
  // Per-claim verify header (live replay only) — the claim MiroMind is researching.
  if (claimMark) {
    return (
      <li className="mt-1 flex items-start gap-2 border-t border-border/60 pt-2 text-xs">
        <span className="shrink-0 rounded-[5px] bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
          ★ Verify {claimMark.index}/{claimMark.total}
        </span>
        <span className="min-w-0 flex-1 text-foreground">{claimMark.text}</span>
      </li>
    );
  }

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
        <ul className="ml-6 flex flex-col gap-1.5 border-l border-border pl-3">
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
