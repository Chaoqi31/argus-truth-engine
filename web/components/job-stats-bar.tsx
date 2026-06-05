"use client";

import type { Job } from "@/lib/types";
import { formatNumber } from "@/lib/format";
import { useArgusStore } from "@/lib/store";

interface Props {
  job: Job;
}

interface Stat {
  label: string;
  value: string;
  detail?: string;
  detailTone?: "muted" | "warning";
  hint?: string;
  warn?: boolean;
}

function traceToolCounts(trace: Job["traces"][number]) {
  const searchesFromSteps = trace.steps.filter((s) => s.type === "web_search").length;
  return {
    searches: trace.num_search_queries > 0 ? trace.num_search_queries : searchesFromSteps,
    fetches: trace.steps.filter((s) => s.type === "fetch_url_content").length,
    codeSteps: trace.steps.filter(
      (s) => s.type === "execute_python" || s.type === "execute_command",
    ).length,
  };
}

function buildStats(job: Job): Stat[] {
  const totalSteps = job.traces.reduce((n, t) => n + t.steps.length, 0);
  const toolTotals = job.traces.reduce(
    (acc, trace) => {
      const tools = traceToolCounts(trace);
      return {
        searches: acc.searches + tools.searches,
        fetches: acc.fetches + tools.fetches,
        codeSteps: acc.codeSteps + tools.codeSteps,
      };
    },
    { searches: 0, fetches: 0, codeSteps: 0 },
  );
  const totalToolCalls = toolTotals.searches + toolTotals.fetches + toolTotals.codeSteps;
  const contentDomain = job.content_domain ?? "general";

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
    {
      label: "domain",
      value: contentDomain,
      hint: "Content domain used to steer source selection, verifier hints, and cache keys.",
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
      detail: audited < total ? "partial coverage" : undefined,
      detailTone: "warning",
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
  );

  if (totalToolCalls > 0) {
    stats.push({
      label: "tool calls",
      value: formatNumber(totalToolCalls),
      hint: "MiroMind deep-research tools used while verifying claims: web searches, fetched pages, and code execution.",
    });
  }

  stats.push({
    label: "evidence",
    value: String(job.evidences.length),
    hint: "Independent sources fetched and cited across all findings.",
  });

  return stats;
}

export function JobStatsBar({ job }: Props) {
  const reviews = useArgusStore((s) => s.findingReviews);
  const stats = buildStats(job);
  const reviewCounts = job.findings.reduce(
    (acc, finding) => {
      const status = reviews[finding.id]?.status ?? "open";
      if (status === "accepted") acc.accepted += 1;
      else if (status === "disputed") acc.disputed += 1;
      else if (status === "resolved") acc.resolved += 1;
      else acc.open += 1;
      return acc;
    },
    { open: 0, accepted: 0, disputed: 0, resolved: 0 },
  );
  if (job.findings.length > 0) {
    stats.push({
      label: "review",
      value: String(reviewCounts.open),
      detail: `${reviewCounts.accepted} accepted · ${reviewCounts.disputed} disputed`,
      detailTone: "muted",
      warn: reviewCounts.open > 0,
      hint: "Reviewer decisions — the value is open findings still awaiting a decision; accepted and disputed counts follow.",
    });
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 border-b border-border bg-muted/40 px-6 py-2.5">
      {stats.map((s, i) => (
        <div key={s.label} className="flex items-baseline gap-1.5">
          <span
            className="font-mono text-sm font-semibold tabular-nums"
            style={s.warn ? { color: "var(--color-warning-foreground)" } : undefined}
          >
            {s.value}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground" title={s.hint}>
            {s.label}
          </span>
          {s.detail && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                s.detailTone === "muted"
                  ? "bg-muted text-muted-foreground"
                  : "bg-warning/15 text-warning-foreground"
              }`}
            >
              {s.detail}
            </span>
          )}
          {i < stats.length - 1 && <span aria-hidden className="text-border">·</span>}
        </div>
      ))}
    </div>
  );
}
