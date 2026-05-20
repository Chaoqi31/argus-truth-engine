"use client";

import { useEffect, useRef, useState } from "react";
import type { Job, Step } from "@/lib/types";
import { replayTrace } from "@/lib/trace-replayer";
import { stepIcon } from "@/lib/colors";

interface Props {
  job: Job;
}

export function TraceStreamView({ job }: Props) {
  const [shown, setShown] = useState<Step[]>([]);
  const [playing, setPlaying] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const total = job.traces.reduce((n, t) => n + t.steps.length, 0);

  const merged: Step[] = job.traces
    .flatMap((t) => t.steps)
    .sort((a, b) => a.sequence - b.sequence);

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

  const progress = total === 0 ? 0 : shown.length / total;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Trace replay
            </span>
            {playing && (
              <span
                aria-hidden
                className="size-1.5 animate-pulse rounded-full bg-success"
                title="streaming"
              />
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
                className="rounded bg-muted px-2.5 py-1 text-xs hover:bg-border"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={play}
                className="rounded bg-primary px-2.5 py-1 text-xs text-white hover:opacity-90"
              >
                {shown.length === total && shown.length > 0 ? "Replay" : "Start"}
              </button>
            )}
            {shown.length < total && (
              <button
                type="button"
                onClick={skip}
                className="rounded bg-muted px-2.5 py-1 text-xs hover:bg-border"
                title="Skip to end"
              >
                ⤓
              </button>
            )}
          </div>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${(progress * 100).toFixed(1)}%` }}
          />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs">
        {shown.length === 0 ? (
          <p className="text-muted-foreground">
            Click <span className="rounded bg-muted px-1 py-0.5 font-mono">Start</span> to watch
            Argus reason — every step the AI took, streamed in the original cadence.
          </p>
        ) : (
          shown.map((s, i) => (
            <div
              key={s.id}
              className="animate-row-in mb-1 flex items-start gap-2 leading-snug"
            >
              <span aria-hidden className="w-4 shrink-0 text-right text-muted-foreground">
                {(i + 1).toString().padStart(2, " ")}
              </span>
              <span aria-hidden className="shrink-0">{stepIcon[s.type]}</span>
              <span className="shrink-0 text-muted-foreground">[{s.type}]</span>
              <span className="break-words">{s.summary}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
