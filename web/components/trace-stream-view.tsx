"use client";

import { useEffect, useRef, useState } from "react";
import type { Finding, Job, Step } from "@/lib/types";
import { stepIcon, verdictTone } from "@/lib/colors";

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
const ENGINE_BADGE: Record<string, { label: string; cls: string }> = {
  miromind: { label: "★ MiroMind", cls: "bg-primary/15 text-primary" },
  deepseek: { label: "DeepSeek", cls: "bg-muted text-muted-foreground" },
  rules: { label: "deterministic", cls: "bg-muted text-muted-foreground" },
  hitl: { label: "human gate", cls: "bg-warning/15 text-warning-foreground" },
};

interface Stage {
  name: string;
  engine: keyof typeof ENGINE_BADGE;
  outcome: string;
}

function StaticReplay({ job }: { job: Job | null }) {
  // Verify holds the deep MiroMind trace; collapsed by default so the whole
  // pipeline reads as a compact overview first (progressive disclosure).
  const [verifyOpen, setVerifyOpen] = useState(false);

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

  const totalSteps = groups.reduce((n, g) => n + g.steps.length, 0);
  const totalSearches = groups.reduce(
    (n, g) => n + g.steps.filter((s) => s.type === "web_search").length,
    0,
  );

  if (groups.length === 0) {
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

  const nClaims = job.claims.length || groups.length;
  const nConsistency = job.findings.filter((f) => f.agent === "Consistency").length;

  // Phase A (extract claims) + Phase B post-verify stages. The Verify stage is
  // rendered between `pre` and `post` so its deep trace can expand inline.
  const pre: Stage[] = [
    { name: "Parse", engine: "rules", outcome: "Document → text + character offsets" },
    { name: "Planner", engine: "deepseek", outcome: "Audit strategy & domain hints" },
    { name: "Atomizer", engine: "deepseek", outcome: `Split into ${nClaims} atomic claims` },
    { name: "Check-worthiness", engine: "deepseek", outcome: "Opinions & trivia filtered out" },
    { name: "Review gate", engine: "hitl", outcome: `${nClaims} claims selected to verify` },
  ];
  const post: Stage[] = [
    { name: "Consistency", engine: "deepseek", outcome: nConsistency ? `${nConsistency} cross-claim finding${nConsistency > 1 ? "s" : ""}` : "No contradictions found" },
    { name: "Confidence", engine: "rules", outcome: "Scored on 3 measured factors" },
    { name: "Reporter", engine: "deepseek", outcome: job.audit_report_md ? "Executive summary generated" : "—" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Audit pipeline
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {pre.length + 1 + post.length} stages · {totalSearches} web searches
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ol className="flex flex-col">
          {pre.map((s, i) => (
            <StageRow key={s.name} index={i + 1} stage={s} />
          ))}

          {/* Verify — the one MiroMind deep-research stage, expandable */}
          <li className="border-b border-border">
            <button
              type="button"
              onClick={() => setVerifyOpen((o) => !o)}
              aria-expanded={verifyOpen}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground">{pre.length + 1}</span>
              <span aria-hidden className="shrink-0 font-mono text-[10px] text-primary">{verifyOpen ? "▾" : "▸"}</span>
              <span className="shrink-0 text-xs font-semibold text-foreground">Verify</span>
              <span className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium ${ENGINE_BADGE.miromind.cls}`}>
                {ENGINE_BADGE.miromind.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                {nClaims} claims · {totalSteps} steps · {totalSearches} searches
              </span>
            </button>
            {verifyOpen && (
              <ul className="flex flex-col border-t border-border bg-muted/20">
                {groups.map((g) => (
                  <ClaimTraceGroup key={g.finding.id} group={g} />
                ))}
              </ul>
            )}
          </li>

          {post.map((s, i) => (
            <StageRow key={s.name} index={pre.length + 2 + i} stage={s} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StageRow({ index, stage }: { index: number; stage: Stage }) {
  const badge = ENGINE_BADGE[stage.engine];
  return (
    <li className="flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground">{index}</span>
      <span className="shrink-0 text-xs font-semibold text-foreground">{stage.name}</span>
      <span className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">{stage.outcome}</span>
    </li>
  );
}

function ClaimTraceGroup({ group }: { group: ClaimGroup }) {
  const { finding, claimText, steps } = group;
  const [open, setOpen] = useState(false);

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
            <StepItem key={s.id} step={s} />
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

function StepItem({ step }: { step: Step }) {
  const icon = stepIcon[step.type] ?? "⚙";
  const isSearch = step.type === "web_search";
  const isFetch = step.type === "fetch_url_content";
  const hits = isSearch ? parseSearchHits(step.content) : [];
  const [open, setOpen] = useState(false);

  return (
    <li className="flex flex-col gap-1 text-xs">
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
    </li>
  );
}
