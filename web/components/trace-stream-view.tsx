"use client";

import { useEffect, useRef } from "react";
import type { Job, Step } from "@/lib/types";
import { stepIcon } from "@/lib/colors";

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

function StaticReplay({ job }: { job: Job | null }) {
  const total = job ? job.traces.reduce((n, t) => n + t.steps.length, 0) : 0;
  const merged: Step[] = job
    ? job.traces.flatMap((t) => t.steps).sort((a, b) => a.sequence - b.sequence)
    : [];

  if (!job) {
    return (
      <div className="flex h-full items-center justify-center px-3 text-xs text-muted-foreground">
        No job loaded.
      </div>
    );
  }

  if (total === 0) {
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

  // Static list of every reasoning step (no replay controls).
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Reasoning trace
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {total} steps
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <ol className="flex flex-col gap-1">
          {merged.map((s) => (
            <StepItem key={s.id} step={s} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StepItem({ step }: { step: Step }) {
  const icon = stepIcon[step.type] ?? "⚙";
  const isSearch = step.type === "web_search";
  const isFetch = step.type === "fetch_url_content";

  return (
    <li className="flex items-start gap-2 text-xs">
      <span aria-hidden className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        {isSearch ? (
          <span className="text-foreground">
            <span className="text-muted-foreground">search </span>
            <span className="font-medium">{step.summary.replace(/^search:\s*/i, "")}</span>
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
    </li>
  );
}
