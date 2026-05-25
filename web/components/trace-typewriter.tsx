"use client";

import { useEffect, useState } from "react";

const LINES = [
  { seq: 1, icon: "plan", agent: "Planner", text: 'Extracting 24 claims from document…' },
  { seq: 3, icon: "search", agent: "CitationVerifier", text: '"Smith 2021 widget resilience SSRN"' },
  { seq: 4, icon: "fetch", agent: "CitationVerifier", text: "https://api.crossref.org/works/…" },
  { seq: 5, icon: "think", agent: "CitationVerifier", text: '"Crossref returned 404. Checking arXiv…"' },
  { seq: 6, icon: "finding", agent: "CitationVerifier", text: "fabricated · major · 0.91" },
  { seq: 8, icon: "search", agent: "DataFreshness", text: '"US GDP growth rate 2024 FRED"' },
  { seq: 9, icon: "finding", agent: "DataFreshness", text: "stale · critical · 0.96" },
  { seq: 11, icon: "think", agent: "Challenger", text: '"Attacker: could this be a preprint?"' },
  { seq: 12, icon: "finding", agent: "Challenger", text: "verdict upheld after debate" },
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
