"use client";

import { useEffect, useState } from "react";

/**
 * Light "live reasoning" panel for the homepage transparency section — mirrors
 * the cockpit's expanded-claim drill-down. One real claim from the default legal
 * demo (Shute's reversed holding): its trace steps stream in line by line and
 * the search counter races 0 → 11, then it loops. Everything fits in view — no
 * internal scroll. Respects prefers-reduced-motion (renders complete).
 */

type Step = { icon: string; text: string; meta?: string; tone?: "danger" };

const STEPS: Step[] = [
  { icon: "🔍", text: "Shute 499 U.S. 585 forum-selection holding", meta: "source found" },
  { icon: "📄", text: "fetch: Supreme Court opinion via Justia", meta: "clause enforced" },
  { icon: "📄", text: "fetch: Cornell LII opinion text", meta: "same holding" },
  { icon: "💭", text: "Compare document claim: unenforceable vs. sources: enforceable" },
  { icon: "✓", text: "3 sources agree on the opposite holding", meta: "high confidence" },
  { icon: "●", text: "inaccurate · 0.99", tone: "danger" },
];

const TARGET_SEARCHES = 11;
const STEP_MS = 600;
const START_MS = 700;
const HOLD_MS = 3000;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function LiveReasoningPanel() {
  const [reducedMotion] = useState(prefersReducedMotion);
  const [shown, setShown] = useState(() => (reducedMotion ? STEPS.length : 0));
  const [searches, setSearches] = useState(() => (reducedMotion ? TARGET_SEARCHES : 0));

  useEffect(() => {
    if (reducedMotion) return;
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
      for (let i = 1; i <= STEPS.length; i++) {
        timers.push(setTimeout(() => setShown(i), START_MS + (i - 1) * STEP_MS));
      }
      timers.push(setTimeout(cycle, START_MS + STEPS.length * STEP_MS + HOLD_MS));
    };
    const kickoff = setTimeout(cycle, 500);
    return () => {
      clearTimeout(kickoff);
      timers.forEach(clearTimeout);
      if (counter) clearInterval(counter);
    };
  }, [reducedMotion]);

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-background shadow-[var(--shadow-card-hover)]">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-3">
        <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success" />
          Live reasoning trace
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">1 of 5 claims</span>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 text-[14px]">
          <span aria-hidden className="font-mono text-[10px] text-muted-foreground">▾</span>
          <span className="flex-1 truncate font-medium text-foreground">Shute holding reversal</span>
          <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider bg-[color-mix(in_oklab,var(--cc-danger,#d92d20)_15%,transparent)] text-[var(--cc-danger,#d92d20)]">
            inaccurate
          </span>
        </div>
        <span className="ml-5 mt-1.5 block font-mono text-[12px] tabular-nums text-muted-foreground">
          💭 3 reasoning · 🔍 {searches} source checks
        </span>
        <ol className="mt-4 flex min-h-[176px] flex-col gap-3 border-l border-border pl-4 font-mono text-[12.5px] leading-snug">
          {STEPS.slice(0, shown).map((s, i) => (
            <li key={i} className="animate-row-in flex items-start gap-2.5">
              <span aria-hidden className={`mt-px shrink-0 ${s.tone ? "text-[var(--cc-danger,#d92d20)]" : ""}`}>{s.icon}</span>
              <span className={`min-w-0 flex-1 ${s.tone ? "font-semibold text-[var(--cc-danger,#d92d20)]" : "text-foreground"}`}>
                {s.text}
              </span>
              {s.meta && <span className="shrink-0 text-muted-foreground">{s.meta}</span>}
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
