"use client";

import type { Job } from "@/lib/types";

interface Props {
  job: Job;
}

interface Stat {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}

function buildStats(job: Job): Stat[] {
  const totalSearches = job.traces.reduce((n, t) => n + t.steps.filter((s) => s.type === "web_search").length, 0);
  const totalSteps = job.traces.reduce((n, t) => n + t.steps.length, 0);

  const stats: Stat[] = [
    {
      label: "claims",
      value: String(job.claims.length),
      hint: "Distinct factual statements extracted from the PDF by the Planner agent.",
    },
    {
      label: "findings",
      value: String(job.findings.length),
      hint: "Verdicts from the autonomous verifier (one per checked claim) plus the consistency checker's cross-claim contradictions.",
    },
  ];

  // Audit coverage — surfaces partial runs (e.g. budget cap) instead of
  // letting an incomplete audit look complete.
  const total = job.claims_total ?? 0;
  if (total > 0) {
    const audited = job.claims_audited ?? 0;
    stats.push({
      label: "audited",
      value: `${audited}/${total}`,
      warn: audited < total,
      hint:
        audited < total
          ? "Partial coverage — the audit stopped before every selected claim was verified (e.g. budget cap or an unparseable result)."
          : "Every selected claim received a verdict.",
    });
  }

  stats.push(
    {
      label: "reasoning steps",
      value: String(totalSteps),
      hint: "Total agent actions (thinking, searches, fetches, code) taken to reach every verdict.",
    },
    {
      label: "web searches",
      value: String(totalSearches),
      hint: "Live web_search tool calls issued by agents while verifying claims.",
    },
    {
      label: "evidence",
      value: String(job.evidences.length),
      hint: "Independent sources fetched and cited across all findings.",
    },
  );

  return stats;
}

export function JobStatsBar({ job }: Props) {
  const stats = buildStats(job);
  return (
    <div className="flex w-full items-center gap-6 overflow-x-auto border-b border-border bg-muted/40 px-6 py-2.5">
      {stats.map((s, i) => (
        <div key={s.label} className="flex shrink-0 items-baseline gap-1.5">
          <span
            className="font-mono text-sm font-semibold tabular-nums"
            style={s.warn ? { color: "var(--color-warning-foreground)" } : undefined}
          >
            {s.value}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground" title={s.hint}>
            {s.label}
          </span>
          {i < stats.length - 1 && <span aria-hidden className="ml-5 text-border">·</span>}
        </div>
      ))}
    </div>
  );
}
