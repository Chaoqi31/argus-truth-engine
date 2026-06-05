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

export function ReasoningWalkthroughCta({ job, onStart }: Props) {
  const finding = pickWalkthroughFinding(job);
  const trace = finding ? traceFor(job, finding) : null;
  const disabled = finding === null;
  const searches = finding ? countSearches(job, finding) : 0;
  const sources = finding?.evidence_ids.length ?? 0;
  const verdict = finding?.verdict.replaceAll("-", " ") ?? "no saved trace";
  const steps = trace?.steps.length ?? 0;
  const primaryMeta = [verdict, noun(steps, "step")].join(" · ");
  const secondaryMeta = [noun(searches, "search", "searches"), noun(sources, "source")].join(" · ");

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (finding) onStart(finding.id);
        }}
        className="group relative inline-flex min-h-9 items-center gap-2 overflow-hidden rounded-[10px] border border-[var(--cc-primary)] bg-background px-3 py-1.5 text-xs font-semibold text-[var(--cc-primary)] shadow-[var(--shadow-card)] transition-[transform,background-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-white/35 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 hover:bg-primary hover:text-white hover:shadow-[0_16px_38px_rgba(113,50,245,0.22)] hover:before:translate-x-[430%] hover:before:opacity-100 active:translate-y-0 active:scale-[0.985] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:border-border disabled:text-muted-foreground disabled:opacity-70 motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden"
      >
        <span aria-hidden className="relative transition-transform duration-300 ease-enter group-hover:translate-x-0.5 motion-reduce:transform-none">↳</span>
        <span className="relative">Walk through reasoning</span>
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
