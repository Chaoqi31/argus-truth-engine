"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Light "live reasoning" panel for the homepage transparency section — mirrors
 * the cockpit's streaming live trace: real thinking / search / fetch / verdict
 * steps from the NVIDIA sample audit stream in line by line, the panel
 * auto-scrolls, the step counter climbs, then it loops. Respects
 * prefers-reduced-motion (renders the full trace, no loop).
 */

type Step = { icon: string; text: string; meta?: string; tone?: "ok" | "danger" };

const STEPS: Step[] = [
  { icon: "💭", text: 'Verify claim: "NVIDIA was founded in 1993"' },
  { icon: "🔍", text: "google_search: NVIDIA founded year", meta: "10 results" },
  { icon: "💭", text: "Confirmed — founded April 5, 1993 (primary sources)" },
  { icon: "●", text: "ok · 0.98", tone: "ok" },
  { icon: "💭", text: "Verify: data-center revenue $148B in FY2025" },
  { icon: "🔍", text: "google_search: NVIDIA data-center revenue FY2025", meta: "8 results" },
  { icon: "📄", text: "fetch: investor.nvidia.com — FY2025 results" },
  { icon: "💭", text: "Segment was ~$115B — and $148B exceeds $130.5B total" },
  { icon: "●", text: "inaccurate · 0.99", tone: "danger" },
  { icon: "💭", text: 'Verify citation: Goldman "Silicon Supercycle" report' },
  { icon: "🔍", text: 'google_search: "Silicon Supercycle" Goldman Sachs', meta: "0 results" },
  { icon: "🔍", text: 'site:goldmansachs.com "Silicon Supercycle"', meta: "0 results" },
  { icon: "🔍", text: '"Silicon Supercycle" filetype:pdf', meta: "0 results" },
  { icon: "💭", text: "No record across 77 search variants — invented" },
  { icon: "●", text: "fabricated · 0.93", tone: "danger" },
];

const STEP_MS = 430;
const HOLD_MS = 2800;
const TONE: Record<string, string> = {
  ok: "text-[var(--cc-ok,#149e61)]",
  danger: "text-[var(--cc-danger,#d92d20)]",
};

export function LiveReasoningPanel() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(STEPS.length);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      setShown(0);
      for (let i = 1; i <= STEPS.length; i++) {
        timers.push(setTimeout(() => setShown(i), i * STEP_MS));
      }
      timers.push(setTimeout(cycle, STEPS.length * STEP_MS + HOLD_MS));
    };
    const kickoff = setTimeout(cycle, 500);
    return () => {
      clearTimeout(kickoff);
      timers.forEach(clearTimeout);
    };
  }, []);

  // Auto-scroll to the newest step as the firehose grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [shown]);

  const streaming = shown < STEPS.length;

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-background shadow-[var(--shadow-card-hover)]">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-3">
        <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success" />
          Live reasoning trace
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {shown} {shown === 1 ? "step" : "steps"}
        </span>
      </div>
      <div ref={scrollRef} className="h-[360px] overflow-y-auto px-4 py-3">
        <ol className="flex flex-col gap-2.5 font-mono text-[12px] leading-snug">
          {STEPS.slice(0, shown).map((s, i) => (
            <li key={i} className="animate-row-in flex items-start gap-2.5">
              <span aria-hidden className={`mt-px shrink-0 ${s.tone ? TONE[s.tone] : ""}`}>{s.icon}</span>
              <span className={`min-w-0 flex-1 ${s.tone ? `font-semibold ${TONE[s.tone]}` : "text-foreground"}`}>
                {s.text}
              </span>
              {s.meta && <span className="shrink-0 text-muted-foreground">{s.meta}</span>}
            </li>
          ))}
          {streaming && (
            <li aria-hidden className="text-muted-foreground">
              <span className="animate-pulse">▍</span>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}
