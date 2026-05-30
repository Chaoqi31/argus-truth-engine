"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ConfidenceBreakdownData } from "@/lib/types";

interface Props {
  breakdown: ConfidenceBreakdownData;
}

const FACTORS: ReadonlyArray<{ key: keyof ConfidenceBreakdownData; label: string }> = [
  { key: "source_agreement", label: "Source agreement" },
  { key: "source_authority", label: "Source authority" },
  { key: "evidence_freshness", label: "Evidence freshness" },
  { key: "evidence_specificity", label: "Evidence specificity" },
];

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Bar that grows 0 → pct% then emits a brief purple burst at the tip. */
function GrowBar({ pct, delay }: { pct: number; delay: number }) {
  const reduceMotion = useReducedMotion();
  const delayS = delay / 1000;
  const showBurst = !reduceMotion && pct > 2;

  return (
    <div className="relative mt-1 h-1.5 w-full">
      {/* Track + animated fill (clipped so bar never overflows track) */}
      <div className="absolute inset-0 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-[#5741d8]"
          initial={{ width: "0%" }}
          animate={{ width: `${pct}%` }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.9, delay: delayS, ease: [0.22, 1, 0.36, 1] }
          }
        />
      </div>

      {/*
       * Burst layers — absolutely positioned at the bar's final tip.
       * Sit outside the clipped track div so they can overflow freely.
       * Fire just as the bar eases into its final position (~delayS + 0.88s).
       */}
      {showBurst && (
        <>
          {/* Radial glow: expands outward and fades */}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${pct}%`,
              width: 20,
              height: 20,
              background:
                "radial-gradient(circle, rgba(113,50,245,0.72) 0%, transparent 65%)",
            }}
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{ scale: [0.2, 2.8, 0.2], opacity: [0, 0.62, 0] }}
            transition={{ duration: 0.65, delay: delayS + 0.88, ease: "easeOut" }}
          />
          {/* Ring ripple: thin ring expands and fades — the "射线" accent */}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${pct}%`,
              width: 6,
              height: 6,
              border: "1.5px solid rgba(113,50,245,0.55)",
            }}
            initial={{ scale: 0.5, opacity: 0.6 }}
            animate={{ scale: 4.2, opacity: 0 }}
            transition={{ duration: 0.55, delay: delayS + 0.9, ease: "easeOut" }}
          />
        </>
      )}
    </div>
  );
}

export function ConfidenceBreakdown({ breakdown }: Props) {
  return (
    <div className="space-y-2.5">
      <p className="text-sm leading-snug text-foreground">{breakdown.reasoning}</p>
      <div className="space-y-2.5 pt-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Breakdown
        </span>
        {FACTORS.map(({ key, label }, i) => {
          const value = clamp01(breakdown[key] as number);
          const pct = Math.round(value * 100);
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-foreground">{label}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </div>
              <GrowBar pct={pct} delay={i * 110} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
