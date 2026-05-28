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

export function ConfidenceBreakdown({ breakdown }: Props) {
  return (
    <div className="space-y-2.5">
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
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              {/* Grows 0 → value with a purple glow (see globals .cc-bar-animate);
                  staggered per factor. Honors prefers-reduced-motion. */}
              <div
                className="cc-bar-animate h-full rounded-full bg-gradient-to-r from-primary to-[var(--cc-primary-bright,#7132f5)]"
                style={
                  {
                    "--cc-fill": `${pct}%`,
                    "--cc-delay": `${i * 110}ms`,
                  } as React.CSSProperties
                }
              />
            </div>
          </div>
        );
      })}
      <p className="pt-0.5 text-xs leading-snug text-muted-foreground">{breakdown.reasoning}</p>
    </div>
  );
}
