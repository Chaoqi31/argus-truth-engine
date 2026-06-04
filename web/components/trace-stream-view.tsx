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
}

export function TraceStreamView({ job, liveMode = false, liveSteps = [] }: Props) {
  if (liveMode) return <LiveTrace steps={liveSteps} />;
  return <StaticReplay job={job} />;
}

function LiveTrace({ steps }: { steps: Step[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [steps.length]);
  useEffect(() => {
    if (steps.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [steps.length]);

  const groups = groupLiveSteps(steps);
  const currentClaim = [...groups].reverse().find((g) => g.type === "claim") ?? null;
  const totalSearches = steps.filter((s) => s.type === "web_search").length;
  const totalFetches = steps.filter((s) => s.type === "fetch_url_content").length;
  const sourceCount = steps.filter((s) => {
    const result = s.content?.result;
    return s.type === "web_search" && typeof result === "string" && result.includes("organic");
  }).length;
  const firstAt = Date.parse(steps[0]?.created_at ?? "");
  const elapsed = Number.isFinite(firstAt) ? formatElapsed(now - firstAt) : "0s";

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
          <LiveChip label="searches" value={totalSearches} />
          <LiveChip label="fetches" value={totalFetches} />
          <LiveChip label="source sets" value={sourceCount} />
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
          </ol>
        )}
      </div>
    </div>
  );
}

function LiveChip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="rounded border border-border bg-background px-1.5 py-0.5">
      <span className="text-foreground">{value}</span> {label}
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

function groupLiveSteps(steps: Step[]): LiveStepGroup[] {
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
      const group = pushClaim(
        `claim-${claimId}`,
        claimId,
        typeof content.agent === "string" ? content.agent : "MiroMind deep research",
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
      <li className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-primary">{group.label}</p>
        {group.meta && <p className="mt-0.5 text-xs text-muted-foreground">{group.meta}</p>}
      </li>
    );
  }

  return (
    <li className="rounded-md border border-border bg-background">
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
            <StepItem key={s.id} step={s} />
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

function StaticReplay({ job }: { job: Job | null }) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set(["verify"]));
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

  // Persisted per-stage summary when present; otherwise derive a thinner view
  // from the job so older fixtures/jobs still render every stage.
  const stages: Stage[] = job.stages?.length ? job.stages : deriveStages(job, groups);
  const effectiveOpenKeys =
    highlightedStepId !== null ? new Set([...openKeys, "verify"]) : openKeys;

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

  const toggle = (k: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Audit pipeline
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {stages.length} stages · {totalSearches} web searches
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <ol className="flex flex-col">
          {stages.map((s, i) => (
            <StageItem
              key={s.key}
              index={i + 1}
              stage={s}
              open={effectiveOpenKeys.has(s.key)}
              onToggle={() => toggle(s.key)}
              groups={groups}
              job={job}
              highlightedStepId={highlightedStepId}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StageItem({
  index,
  stage,
  open,
  onToggle,
  groups,
  job,
  highlightedStepId,
}: {
  index: number;
  stage: Stage;
  open: boolean;
  onToggle: () => void;
  groups: ClaimGroup[];
  job: Job;
  highlightedStepId: string | null;
}) {
  const badge = ENGINE_BADGE[stage.engine] ?? ENGINE_BADGE.deterministic;
  const isVerify = stage.key === "verify";
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      >
        <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground">{index}</span>
        <span aria-hidden className="shrink-0 font-mono text-[10px] text-primary">{open ? "▾" : "▸"}</span>
        <span className="shrink-0 text-xs font-semibold text-foreground">{stage.name}</span>
        <span className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
          {stage.summary}
        </span>
      </button>
      {open &&
        (isVerify ? (
          groups.length > 0 ? (
            <ul className="flex flex-col border-t border-border bg-muted/20">
              {groups.map((g, groupIndex) => (
                <ClaimTraceGroup
                  key={g.finding.id}
                  group={g}
                  highlightedStepId={highlightedStepId}
                  initiallyOpen={groupIndex === 0}
                />
              ))}
            </ul>
          ) : (
            <div className="border-t border-border bg-muted/20 px-3 py-3 pl-9 text-[11px] text-muted-foreground">
              No MiroMind reasoning trace recorded for this run.
            </div>
          )
        ) : (
          <StageDetail stage={stage} job={job} />
        ))}
    </li>
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
  return (
    <div className="flex flex-col gap-2.5 border-t border-border bg-muted/20 px-3 py-3 pl-9">
      {STAGE_BLURB[stage.key] && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{STAGE_BLURB[stage.key]}</p>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-baseline gap-1 rounded-[6px] bg-background px-1.5 py-0.5 text-[10px]"
            >
              <span className="font-mono font-semibold tabular-nums text-foreground">{v}</span>
              <span className="text-muted-foreground">{METRIC_LABEL[k] ?? k}</span>
            </span>
          ))}
        </div>
      )}

      {(stage.key === "planner" || stage.key === "atomizer" || stage.key === "checkworthiness") &&
        job.claims.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {stage.key === "planner"
                ? "Candidate claims"
                : stage.key === "atomizer"
                  ? "Atomic claims"
                  : "Kept as check-worthy"}
            </p>
            <ul className="flex flex-col gap-1">
              {job.claims.map((c) => (
                <li
                  key={c.id}
                  className="rounded-[6px] border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
                >
                  {c.text}
                </li>
              ))}
            </ul>
          </div>
        )}

      {stage.key === "planner" && stage.strategy && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
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
                className="rounded-[6px] border border-border bg-background px-2 py-1.5 text-[11px]"
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
                  className="rounded-[6px] border border-border bg-background px-2 py-1.5 text-[11px]"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-foreground">
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
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            No findings required independent challenge.
          </p>
        )
      )}

      {stage.key === "consistency" && consistencyFindings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {consistencyFindings.map((f) => (
            <li
              key={f.id}
              className="rounded-[6px] border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground"
            >
              <span className="font-mono text-[9px] uppercase tracking-wider text-foreground">
                {f.verdict}
              </span>
              <span className="ml-1.5">{f.summary}</span>
            </li>
          ))}
        </ul>
      )}

      {stage.key === "confidence" && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Each verdict is scored on three measured factors — source authority, evidence freshness,
          and source agreement.
        </p>
      )}

      {stage.key === "reporter" && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {job.audit_report_md
            ? "The full executive summary is rendered in the report panel."
            : "No executive summary was generated for this run."}
        </p>
      )}
    </div>
  );
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

function ClaimTraceGroup({
  group,
  highlightedStepId,
  initiallyOpen = false,
}: {
  group: ClaimGroup;
  highlightedStepId: string | null;
  initiallyOpen?: boolean;
}) {
  const { finding, claimText, steps } = group;
  const containsHighlight =
    highlightedStepId != null && steps.some((s) => s.id === highlightedStepId);
  const [open, setOpen] = useState(initiallyOpen);
  const isOpen = open || containsHighlight;

  const nThink = steps.filter((s) => s.type === "thinking").length;
  const nSearch = steps.filter((s) => s.type === "web_search").length;
  const nFetch = steps.filter((s) => s.type === "fetch_url_content").length;
  const nSources = finding.evidence_ids.length;
  const nReasoning = finding.reasoning_chain?.length ?? nThink;
  const tone = verdictTone[finding.verdict] ?? "muted";

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={isOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {isOpen ? "▾" : "▸"}
        </span>
        <span className="min-w-0 truncate text-xs font-medium text-foreground">{claimText}</span>
        <span
          className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium capitalize ${TONE_BADGE[tone]}`}
        >
          {finding.verdict}
        </span>
        <span className="col-start-2 col-end-4 flex min-w-0 flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <TraceMetric value={nSources} label="source" />
          <TraceMetric value={nReasoning} label="reasoning step" />
          <TraceMetric value={nSearch} label="search" />
          {nFetch > 0 && <TraceMetric value={nFetch} label="fetch" />}
        </span>
      </button>
      {isOpen && (
        <div className="bg-muted/30">
          <VerdictBrief finding={finding} />
          <ol className="flex flex-col gap-1 px-3 py-2 pl-7">
            {steps.map((s) => (
              <StepItem key={s.id} step={s} highlighted={s.id === highlightedStepId} />
            ))}
          </ol>
        </div>
      )}
    </li>
  );
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

function TraceMetric({ value, label }: { value: number; label: string }) {
  const displayLabel = pluralizeTraceMetric(label, value);
  return (
    <span className="rounded border border-border bg-background px-1.5 py-0.5">
      <span className="text-foreground">{value}</span> {displayLabel}
    </span>
  );
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

function StepItem({ step, highlighted = false }: { step: Step; highlighted?: boolean }) {
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
      className={`flex flex-col gap-1 rounded-[6px] text-xs ${highlighted ? "-mx-1.5 bg-primary/10 px-1.5 py-1 ring-1 ring-primary/40" : ""}`}
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
