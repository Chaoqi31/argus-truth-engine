"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Light, looping "live reasoning" panel for the homepage transparency section.
 * Streams a real drill-down from the NVIDIA sample audit (Goldman fabricated
 * citation) line-by-line, races the search counter 0 → 77, and loops — so the
 * section literally shows the verifier thinking. Starts when scrolled into
 * view; respects prefers-reduced-motion (renders the finished trace, no loop).
 */

const STEPS: { kind: "search" | "think" | "verdict"; text: string; meta?: string }[] = [
  { kind: "search", text: 'site:goldmansachs.com "Silicon Supercycle"', meta: "0 hits" },
  { kind: "search", text: '"Silicon Supercycle" filetype:pdf', meta: "0 hits" },
  { kind: "think", text: "No record across 77 search variants" },
  { kind: "verdict", text: "fabricated · 0.93" },
];
const TARGET_SEARCHES = 77;
const STEP_MS = 650;
const START_MS = 700;
const HOLD_MS = 2600;

export function LiveReasoningPanel() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(0);
  const [searches, setSearches] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(STEPS.length);
      setSearches(TARGET_SEARCHES);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    let counter: ReturnType<typeof setInterval> | null = null;

    const cycle = () => {
      setShown(0);
      setSearches(0);
      if (counter) clearInterval(counter);
      let c = 0;
      counter = setInterval(() => {
        c = Math.min(TARGET_SEARCHES, c + 4);
        setSearches(c);
        if (c >= TARGET_SEARCHES && counter) clearInterval(counter);
      }, 45);
      STEPS.forEach((_, i) => {
        timers.push(setTimeout(() => setShown(i + 1), START_MS + i * STEP_MS));
      });
      timers.push(setTimeout(cycle, START_MS + STEPS.length * STEP_MS + HOLD_MS));
    };

    const kickoff = setTimeout(cycle, 400);

    return () => {
      clearTimeout(kickoff);
      timers.forEach(clearTimeout);
      if (counter) clearInterval(counter);
    };
  }, []);

  return (
    <div ref={ref} className="overflow-hidden rounded-[14px] border border-border bg-background shadow-[var(--shadow-card-hover)]">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5">
        <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success" />
          Live reasoning trace
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">1 of 7 claims</span>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2 text-[13px]">
          <span aria-hidden className="font-mono text-[9px] text-muted-foreground">▾</span>
          <span className="flex-1 truncate font-medium text-foreground">Goldman “Silicon Supercycle” report</span>
          <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider bg-[color-mix(in_oklab,var(--cc-danger,#d92d20)_15%,transparent)] text-[var(--cc-danger,#d92d20)]">
            fabricated
          </span>
        </div>
        <span className="ml-4 mt-1 block font-mono text-[11px] tabular-nums text-muted-foreground">
          💭 91 reasoning · 🔍 {searches} searches
        </span>
        <ol className="mt-3 min-h-[104px] space-y-2 border-l border-border pl-3 font-mono text-[11px]">
          {STEPS.slice(0, shown).map((s, i) => (
            <li
              key={i}
              className={`animate-row-in ${
                s.kind === "verdict"
                  ? "flex items-center gap-1.5 text-[var(--cc-danger,#d92d20)]"
                  : s.kind === "think"
                    ? "text-muted-foreground"
                    : "flex items-center justify-between gap-2 text-foreground"
              }`}
            >
              {s.kind === "search" && (
                <>
                  <span className="truncate"><span className="text-muted-foreground">🔍 </span>{s.text}</span>
                  <span className="shrink-0 text-muted-foreground">{s.meta}</span>
                </>
              )}
              {s.kind === "think" && <span>💭 {s.text}</span>}
              {s.kind === "verdict" && (
                <>
                  <span aria-hidden>●</span>
                  <span>{s.text}</span>
                </>
              )}
            </li>
          ))}
          {shown < STEPS.length && (
            <li aria-hidden className="text-muted-foreground">
              <span className="animate-pulse">▍</span>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}
