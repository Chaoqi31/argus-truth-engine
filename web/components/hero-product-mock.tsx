"use client";

import { TraceTypewriter } from "@/components/trace-typewriter";

/**
 * A stylized "browser frame" showing a mock audit result + live trace.
 * Pure presentation — no data fetching.
 */
export function HeroProductMock() {
  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-[#101114] shadow-[var(--shadow-card-hover)]">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-white/20" />
          <span className="size-2.5 rounded-full bg-white/20" />
          <span className="size-2.5 rounded-full bg-white/20" />
          <span className="ml-4 flex-1 rounded-md bg-white/5 px-3 py-1 text-[11px] text-white/30">
            argus-truth-engine.vercel.app/audit
          </span>
        </div>

        {/* Content area — two columns */}
        <div className="grid grid-cols-[1fr_260px] divide-x divide-white/10">
          {/* Left: mock findings */}
          <div className="space-y-2.5 p-4">
            <MockFinding
              verdict="fabricated"
              severity="critical"
              confidence={0.91}
              summary='Reference "Sokolov & Reyes (2023)" does not exist in Crossref, arXiv, or SSRN.'
            />
            <MockFinding
              verdict="stale"
              severity="critical"
              confidence={0.96}
              summary="Legislation date Nov 2024 is outdated — current data through March 2025."
            />
            <MockFinding
              verdict="mismatch"
              severity="major"
              confidence={0.85}
              summary="$7,428B outlays figure contradicts $7.0T stated in the executive summary."
            />
          </div>

          {/* Right: trace stream */}
          <div className="p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-white/30">
              Live reasoning trace
            </p>
            <TraceTypewriter />
          </div>
        </div>
      </div>
    </div>
  );
}

function MockFinding({
  verdict,
  severity,
  confidence,
  summary,
}: {
  verdict: string;
  severity: "critical" | "major" | "minor";
  confidence: number;
  summary: string;
}) {
  const severityColor =
    severity === "critical"
      ? "border-red-500/40 bg-red-500/10"
      : severity === "major"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-white/10 bg-white/5";

  const verdictColor =
    verdict === "fabricated"
      ? "text-red-400"
      : verdict === "stale"
        ? "text-amber-400"
        : "text-orange-400";

  return (
    <div className={`rounded-lg border ${severityColor} p-3`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-wider ${verdictColor}`}>
          {verdict}
        </span>
        <span className="font-mono text-[10px] text-white/40">
          {severity} · {confidence.toFixed(2)}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-white/60">{summary}</p>
    </div>
  );
}
