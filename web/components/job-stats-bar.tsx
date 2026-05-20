"use client";

import type { Job } from "@/lib/types";

interface Props {
  job: Job;
}

interface Stat {
  label: string;
  value: string;
  hint?: string;
}

function buildStats(job: Job): Stat[] {
  const totalSteps = job.traces.reduce((n, t) => n + t.steps.length, 0);
  const totalSearches = job.traces.reduce((n, t) => n + t.num_search_queries, 0);
  const tokenStr = formatCompact(job.total_tokens);
  const cost = job.cost_usd ? `$${job.cost_usd.toFixed(2)}` : "—";

  return [
    { label: "claims", value: String(job.claims.length) },
    { label: "findings", value: String(job.findings.length) },
    { label: "agents", value: String(new Set(job.traces.map((t) => t.agent)).size || 1) },
    { label: "reasoning steps", value: String(totalSteps) },
    { label: "web searches", value: String(totalSearches) },
    { label: "tokens", value: tokenStr, hint: "input + output + reasoning" },
    { label: "cost", value: cost },
  ];
}

function formatCompact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function JobStatsBar({ job }: Props) {
  const stats = buildStats(job);
  return (
    <div className="flex w-full items-center gap-6 overflow-x-auto border-b border-border bg-muted/40 px-6 py-2.5">
      {stats.map((s, i) => (
        <div key={s.label} className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-mono text-sm font-semibold tabular-nums">{s.value}</span>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground" title={s.hint}>
            {s.label}
          </span>
          {i < stats.length - 1 && <span aria-hidden className="ml-5 text-border">·</span>}
        </div>
      ))}
    </div>
  );
}
