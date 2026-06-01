"use client";

import { useEffect, useState } from "react";

// Real lines from the bundled NVIDIA sample audit — agents, queries, and
// verdicts all match the fixture. No fabricated trace data.
const LINES = [
  { seq: 1, icon: "plan", agent: "Atomizer", text: "Split into 7 atomic claims" },
  { seq: 2, icon: "search", agent: "UnifiedVerifier", text: '"Silicon Supercycle" Goldman Sachs' },
  { seq: 3, icon: "search", agent: "UnifiedVerifier", text: 'site:goldmansachs.com "Silicon Supercycle"' },
  { seq: 4, icon: "think", agent: "UnifiedVerifier", text: "No record across 77 search variants" },
  { seq: 5, icon: "finding", agent: "UnifiedVerifier", text: "fabricated · major · 0.93" },
  { seq: 6, icon: "search", agent: "UnifiedVerifier", text: '"NVIDIA data-center revenue FY2025"' },
  { seq: 7, icon: "finding", agent: "UnifiedVerifier", text: "inaccurate · major · 0.99" },
  { seq: 8, icon: "think", agent: "ConsistencyChecker", text: '"$148B data-center > $130.5B total"' },
  { seq: 9, icon: "finding", agent: "ConsistencyChecker", text: "contradiction · critical · 1.00" },
];

const ICON_MAP: Record<string, string> = {
  plan: "⚙",
  search: "⌕",
  fetch: "↗",
  think: "◇",
  finding: "●",
};

const ICON_COLOR: Record<string, string> = {
  plan: "text-blue-400",
  search: "text-violet-400",
  fetch: "text-emerald-400",
  think: "text-amber-400",
  finding: "text-green-400",
};

export function TraceTypewriter() {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      // Reduced motion: show the full trace at once, skip the typewriter.
      // Synchronous setState is gated on an external read (matchMedia).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisibleLines(LINES.length);
      return;
    }

    let i = 0;
    const id = setInterval(() => {
      i++;
      if (i >= LINES.length) {
        // Pause then restart
        setTimeout(() => setVisibleLines(0), 2000);
        i = 0;
      }
      setVisibleLines(i);
    }, 700);

    return () => clearInterval(id);
  }, []);

  return (
    <div className="font-mono text-[11px] leading-relaxed text-white/70">
      {LINES.slice(0, visibleLines).map((line, i) => (
        <div
          key={`${line.seq}-${i}`}
          className="animate-row-in flex gap-2 whitespace-nowrap"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <span className="w-8 shrink-0 text-right text-white/30">
            {String(line.seq).padStart(2, " ")}
          </span>
          <span className={`w-4 shrink-0 ${ICON_COLOR[line.icon]}`}>
            {ICON_MAP[line.icon]}
          </span>
          <span className="w-28 shrink-0 text-white/50 truncate">
            {line.agent}
          </span>
          <span className="text-white/60 truncate">{line.text}</span>
        </div>
      ))}
      {visibleLines < LINES.length && (
        <div className="flex gap-2">
          <span className="w-8" />
          <span className="w-4 animate-pulse text-white/30">▍</span>
        </div>
      )}
    </div>
  );
}
