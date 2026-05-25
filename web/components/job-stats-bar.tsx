"use client";

import type { Job } from "@/lib/types";
import { CostChip } from "@/components/cost-chip";

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
  const cost =
    typeof job.cost_usd === "number"
      ? job.cost_usd < 1
        ? `$${job.cost_usd.toFixed(3)}`
        : `$${job.cost_usd.toFixed(2)}`
      : "—";
  const uniqueAgents = new Set(job.traces.map((t) => t.agent)).size;

  return [
    {
      label: "claims",
      value: String(job.claims.length),
      hint: "Distinct factual statements extracted from the PDF by the Planner agent.",
    },
    {
      label: "findings",
      value: String(job.findings.length),
      hint: "Verdicts emitted by specialist agents — one per (claim × applicable check).",
    },
    {
      label: "agents",
      value: String(uniqueAgents || 1),
      hint: "Specialist agents that emitted at least one finding on this audit (of 4 possible: CitationVerifier, CitationAlignment, DataFreshness, ConsistencyChecker).",
    },
    {
      label: "web searches",
      value: String(totalSearches),
      hint: "Live web_search tool calls issued by agents while verifying claims.",
    },
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
      {stats.length > 0 && <span aria-hidden className="text-border">·</span>}
      <CostChip costUsd={job?.cost_usd ?? null} />
    </div>
  );
}
