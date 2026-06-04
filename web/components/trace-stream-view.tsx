"use client";

import { useEffect, useRef, useState } from "react";
import type { Finding, Job, Stage, Step } from "@/lib/types";
import { stepIcon, verdictTone } from "@/lib/colors";
import { useArgusStore } from "@/lib/store";

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
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [steps.length]);

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
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">Waiting for first step…</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {steps.map((s) => (
              <StepItem key={s.id} step={s} />
            ))}
          </ol>
        )}
      </div>
    </div>
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
};

// One-line "what this step does" shown at the top of each expanded stage.
const STAGE_BLURB: Record<string, string> = {
  parse: "Extracts the raw text and character offsets from the document.",
  planner: "Reads the document and pulls out the discrete factual claims worth checking.",
  atomizer: "Splits compound claims into atomic, independently-verifiable statements.",
  checkworthiness: "Drops opinions, forecasts and trivia — keeps only checkable factual claims.",
  review_gate: "De-duplicates the claims and caps how many go to paid verification.",
  verify: "Runs each claim through MiroMind deep research — web searches, fetches, reasoning.",
  consistency: "Checks the claims against each other for contradictions and unsupported leaps.",
  confidence: "Scores each verdict on source authority, evidence freshness and source agreement.",
  reporter: "Writes the executive summary of the audit.",
};

function StaticReplay({ job }: { job: Job | null }) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const highlightedStepId = useArgusStore((s) => s.highlightedStepId);

  // A cross-link from the evidence / finding panels ("show step in the trace")
  // sets highlightedStepId — open the Verify stage so that step is reachable.
  useEffect(() => {
    if (!highlightedStepId) return;
    setOpenKeys((prev) => (prev.has("verify") ? prev : new Set(prev).add("verify")));
  }, [highlightedStepId]);

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
  const groups: ClaimGroup[] = job.findings
    .filter((f) => f.agent === "UnifiedVerifier")
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
      <div className="flex-1 overflow-y-auto">
        <ol className="flex flex-col">
          {stages.map((s, i) => (
            <StageItem
              key={s.key}
              index={i + 1}
              stage={s}
              open={openKeys.has(s.key)}
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
              {groups.map((g) => (
                <ClaimTraceGroup key={g.finding.id} group={g} highlightedStepId={highlightedStepId} />
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
}: {
  group: ClaimGroup;
  highlightedStepId: string | null;
}) {
  const { finding, claimText, steps } = group;
  const containsHighlight =
    highlightedStepId != null && steps.some((s) => s.id === highlightedStepId);
  const [open, setOpen] = useState(false);

  // Auto-open when a contained step is cross-linked; the user can still close it.
  useEffect(() => {
    if (containsHighlight) setOpen(true);
  }, [containsHighlight]);

  const nThink = steps.filter((s) => s.type === "thinking").length;
  const nSearch = steps.filter((s) => s.type === "web_search").length;
  const nFetch = steps.filter((s) => s.type === "fetch_url_content").length;
  const tone = verdictTone[finding.verdict] ?? "muted";

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{claimText}</span>
        <span
          className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium capitalize ${TONE_BADGE[tone]}`}
        >
          {finding.verdict}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          💭{nThink} · 🔍{nSearch}
          {nFetch > 0 ? ` · 📄${nFetch}` : ""}
        </span>
      </button>
      {open && (
        <ol className="flex flex-col gap-1 bg-muted/30 px-3 py-2 pl-7">
          {steps.map((s) => (
            <StepItem key={s.id} step={s} highlighted={s.id === highlightedStepId} />
          ))}
        </ol>
      )}
    </li>
  );
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
