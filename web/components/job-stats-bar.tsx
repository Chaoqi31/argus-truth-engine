"use client";

import type { Job } from "@/lib/types";
import { getJobExecutionControls, type ExecutionControl } from "@/lib/execution-controls";
import { useArgusStore } from "@/lib/store";
import { useState } from "react";

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
  controls?: ExecutionControl[];
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function noun(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
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
  const reasoningTokens = job.traces.reduce((n, t) => n + t.reasoning_tokens, 0);
  const contentDomain = job.content_domain ?? "general";
  const executionControls = getJobExecutionControls(job);

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

  if (executionControls.requiredCount > 0) {
    const missing = executionControls.requiredCount - executionControls.presentCount;
    stats.push({
      label: "exec controls",
      value: `${executionControls.presentCount}/${executionControls.requiredCount}`,
      detail: missing > 0 ? `${missing} missing` : "background responses · resumable · fan-out",
      detailTone: missing > 0 ? "warning" : "muted",
      warn: missing > 0,
      hint: executionControls.controls
        .filter((control) => control.status === "present")
        .map((control) => control.label)
        .join(" · "),
      controls: executionControls.controls,
    });
  }

  if (totalToolCalls > 0) {
    stats.push({
      label: "tool calls",
      value: formatNumber(totalToolCalls),
      detail: [
        noun(toolTotals.searches, "search", "searches"),
        noun(toolTotals.fetches, "fetch", "fetches"),
        noun(toolTotals.codeSteps, "code step"),
      ].join(" · "),
      detailTone: "muted",
      hint: "MiroMind deep-research tools used while verifying claims: web searches, fetched pages, and code execution.",
    });
  }

  if (job.total_tokens > 0) {
    stats.push({
      label: "tokens",
      value: formatNumber(job.total_tokens),
      detail: reasoningTokens > 0 ? `${formatNumber(reasoningTokens)} reasoning` : undefined,
      detailTone: "muted",
      hint: "Total model tokens for this audit. Reasoning tokens come from the saved MiroMind traces.",
    });
  }

  stats.push(
    {
      label: "evidence",
      value: String(job.evidences.length),
      hint: "Independent sources fetched and cited across all findings.",
    },
    {
      label: "cost",
      value: formatUsd(job.cost_usd),
      hint: "Estimated MiroMind spend for this audit.",
    },
  );

  return stats;
}

export function JobStatsBar({ job }: Props) {
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const reviews = useArgusStore((s) => s.findingReviews);
  const stats = buildStats(job);
  const detailStat = stats.find((stat) => stat.label === openDetails && stat.controls);
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
    stats.push(
      {
        label: "open review",
        value: String(reviewCounts.open),
        warn: reviewCounts.open > 0,
        hint: "Findings still awaiting reviewer decision, including needs-recheck.",
      },
      {
        label: "accepted",
        value: String(reviewCounts.accepted),
        hint: "Findings accepted by the reviewer.",
      },
      {
        label: "disputed",
        value: String(reviewCounts.disputed),
        warn: reviewCounts.disputed > 0,
        hint: "Findings challenged by the reviewer.",
      },
    );
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
          {s.controls ? (
            <button
              type="button"
              className="text-left text-[11px] uppercase tracking-wider text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
              title={s.hint}
              aria-expanded={openDetails === s.label}
              aria-controls="job-stat-details"
              onClick={() => setOpenDetails(openDetails === s.label ? null : s.label)}
            >
              {s.label}
            </button>
          ) : (
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground" title={s.hint}>
              {s.label}
            </span>
          )}
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
      {detailStat?.controls && (
        <div
          id="job-stat-details"
          role="region"
          aria-label={`${detailStat.label} details`}
          className="basis-full rounded border border-border bg-background/80 p-2"
        >
          <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            {detailStat.controls.map((control) => (
              <div key={control.id} className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      control.status === "present"
                        ? "bg-emerald-500/10 text-emerald-700"
                        : control.status === "not_applicable"
                          ? "bg-muted text-muted-foreground"
                          : "bg-warning/15 text-warning-foreground"
                    }`}
                  >
                    {control.status.replace("_", " ")}
                  </span>
                  <span className="truncate text-xs font-medium">{control.label}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{control.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
