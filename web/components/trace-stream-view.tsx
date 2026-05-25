"use client";

import { useEffect, useRef, useState } from "react";
import type { Job, Step } from "@/lib/types";
import { replayTrace } from "@/lib/trace-replayer";
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
  const [shown, setShown] = useState<Step[]>([]);
  const [playing, setPlaying] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const total = job ? job.traces.reduce((n, t) => n + t.steps.length, 0) : 0;
  const merged: Step[] = job
    ? job.traces.flatMap((t) => t.steps).sort((a, b) => a.sequence - b.sequence)
    : [];

  const play = async () => {
    controllerRef.current?.abort();
    setShown([]);
    setPlaying(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    await replayTrace(merged, (s) => setShown((prev) => [...prev, s]), {
      signal: controller.signal,
    });
    setPlaying(false);
  };

  const stop = () => {
    controllerRef.current?.abort();
    setPlaying(false);
  };

  const skip = () => {
    controllerRef.current?.abort();
    setShown(merged);
    setPlaying(false);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [shown]);

  useEffect(() => () => controllerRef.current?.abort(), []);

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
        <p className="text-sm font-medium">Trace replay available during live audits</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          This demo shows a pre-computed audit result. Start a live audit with your own PDF to
          watch every web search, reasoning step, and tool call stream in real time.
        </p>
      </div>
    );
  }

  const progress = shown.length / total;

  // Group steps by agent for the static view
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Trace replay
            </span>
            {playing && (
              <>
                <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success" />
                <span className="sr-only" aria-live="polite">
                  Streaming reasoning steps
                </span>
              </>
            )}
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {shown.length} / {total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {playing ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex min-h-9 items-center rounded-md bg-muted px-3 text-xs font-medium hover:bg-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={play}
                className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-xs font-medium text-white shadow-sm transition-all hover:shadow-md"
              >
                Replay
              </button>
            )}
            <button
              type="button"
              onClick={skip}
              disabled={shown.length === total}
              className="inline-flex min-h-9 items-center rounded-md bg-muted px-3 text-xs font-medium hover:bg-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              Skip
            </button>
          </div>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Click <strong>Replay</strong> to stream the {total} reasoning steps.
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {shown.map((s) => (
              <StepItem key={s.id} step={s} />
            ))}
          </ol>
        )}
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
