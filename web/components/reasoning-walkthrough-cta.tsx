"use client";

import type { Finding, Job } from "@/lib/types";
import { sortFindingsForReview } from "@/lib/findings";
import { noun } from "@/lib/format";

interface Props {
  job: Job;
  onStart: (findingId: string) => void;
}

function traceFor(job: Job, finding: Finding) {
  return job.traces.find((trace) => trace.id === finding.reasoning_trace_id) ?? null;
}

function pickWalkthroughFinding(job: Job): Finding | null {
  return (
    sortFindingsForReview(job.findings).find((finding) => {
      const trace = traceFor(job, finding);
      return finding.agent === "UnifiedVerifier" && !!trace && trace.steps.length > 0;
    }) ?? null
  );
}

function countSearches(job: Job, finding: Finding): number {
  const trace = traceFor(job, finding);
  if (!trace) return 0;
  const stepSearches = trace.steps.filter((step) => step.type === "web_search").length;
  return trace.num_search_queries > 0 ? trace.num_search_queries : stepSearches;
}

function countToolCalls(job: Job, finding: Finding): number {
  const trace = traceFor(job, finding);
  if (!trace) return 0;
  const searches = countSearches(job, finding);
  const fetches = trace.steps.filter((step) => step.type === "fetch_url_content").length;
  const codeSteps = trace.steps.filter(
    (step) => step.type === "execute_python" || step.type === "execute_command",
  ).length;
  return searches + fetches + codeSteps;
}

function tokenLabel(trace: ReturnType<typeof traceFor>): string | null {
  if (!trace) return null;
  if (trace.reasoning_tokens > 0) {
    return noun(trace.reasoning_tokens, "reasoning token");
  }
  if (trace.total_tokens > 0) {
    return noun(trace.total_tokens, "total token");
  }
  return null;
}

export function ReasoningWalkthroughCta({ job, onStart }: Props) {
  const finding = pickWalkthroughFinding(job);
  const trace = finding ? traceFor(job, finding) : null;
  const disabled = finding === null;
  const searches = finding ? countSearches(job, finding) : 0;
  const toolCalls = finding ? countToolCalls(job, finding) : 0;
  const sources = finding?.evidence_ids.length ?? 0;
  const verdict = finding?.verdict.replaceAll("-", " ") ?? "no saved trace";
  const steps = trace?.steps.length ?? 0;
  const primaryMeta = [verdict, noun(steps, "step"), tokenLabel(trace)].filter(Boolean).join(" · ");
  const secondaryMeta = [
    noun(toolCalls, "tool call"),
    noun(searches, "search", "searches"),
    noun(sources, "source"),
  ].join(" · ");

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (finding) onStart(finding.id);
        }}
        className="inline-flex min-h-9 items-center gap-2 rounded-[10px] border border-[var(--cc-primary)] bg-background px-3 py-1.5 text-xs font-semibold text-[var(--cc-primary)] shadow-[var(--shadow-card)] transition-colors hover:bg-primary hover:text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:border-border disabled:text-muted-foreground disabled:opacity-70"
      >
        <span aria-hidden>↳</span>
        Walk through reasoning
      </button>
      {disabled ? (
        <p className="max-w-[18rem] text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          No saved trace
        </p>
      ) : (
        <div className="max-w-[22rem] space-y-0.5 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <p>{primaryMeta}</p>
          <p>{secondaryMeta}</p>
        </div>
      )}
    </div>
  );
}
