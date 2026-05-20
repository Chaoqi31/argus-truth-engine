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

  const play = async () => {
    controllerRef.current?.abort();
    setShown([]);
    setPlaying(true);
    const controller = new AbortController();
    controllerRef.current = controller;

    const merged: Step[] = job.traces
      .flatMap((t) => t.steps)
      .sort((a, b) => a.sequence - b.sequence);

    await replayTrace(merged, (s) => setShown((prev) => [...prev, s]), {
      intervalMs: 250,
      signal: controller.signal,
    });
    setPlaying(false);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [shown]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Trace replay
        </span>
        <button
          type="button"
          onClick={play}
          disabled={playing}
          className="rounded bg-primary px-2.5 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
        >
          {playing ? "Replaying…" : "Replay"}
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs">
        {shown.length === 0 ? (
          <p className="text-muted-foreground">Click Replay to see the live trace.</p>
        ) : (
          shown.map((s) => (
            <div key={s.id} className="mb-1 flex gap-2">
              <span aria-hidden>{stepIcon[s.type]}</span>
              <span className="text-muted-foreground">[{s.type}]</span>
              <span>{s.summary}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
