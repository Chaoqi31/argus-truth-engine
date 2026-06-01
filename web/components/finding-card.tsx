"use client";

import type { Finding } from "@/lib/types";
import { SeverityBadge } from "@/components/severity-badge";
import { verdictTone } from "@/lib/colors";

interface Props {
  finding: Finding;
  active: boolean;
  onClick: () => void;
}

const TONE_BAR: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-[var(--cc-danger,#d92d20)]",
  warn: "bg-[var(--cc-warn,#d18700)]",
  ok: "bg-[var(--cc-ok,#149e61)]",
  muted: "bg-border-strong",
};

const TONE_VERDICT_BADGE: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-[color-mix(in_oklab,var(--cc-danger,#d92d20)_15%,transparent)] text-[var(--cc-danger,#d92d20)]",
  warn: "bg-[color-mix(in_oklab,var(--cc-warn,#d18700)_15%,transparent)] text-[var(--cc-warn,#d18700)]",
  ok: "bg-[color-mix(in_oklab,var(--cc-ok,#149e61)_15%,transparent)] text-[var(--cc-ok,#149e61)]",
  muted: "bg-muted text-muted-foreground",
};

const TONE_RING: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "var(--cc-danger, #d92d20)",
  warn: "var(--cc-warn, #d18700)",
  ok: "var(--cc-ok, #149e61)",
  muted: "var(--cc-text-muted, #9497a9)",
};

/**
 * Finding card — light cockpit treatment.
 *
 * Keeps the existing button semantics + onClick contract (FindingsTab passes
 * `onClick` to select the finding). Subtle border/shadow hover lift and a small
 * confidence ring — no neon glow.
 */
export function FindingCard({ finding, active, onClick }: Props) {
  const tone = verdictTone[finding.verdict];
  const pct = Math.round(finding.confidence * 100);

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-[var(--radius-card)] border bg-background shadow-[var(--shadow-card)] transition-all hover:-translate-y-px hover:shadow-[var(--shadow-card-hover)] ${
        active ? "border-primary" : "border-border hover:border-border-strong"
      }`}
    >
      {/* Vertical accent bar coloured by verdict tone */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${TONE_BAR[tone]}`} />

      {/* Body — the primary click target selects the finding. */}
      <button
        type="button"
        onClick={onClick}
        className="relative block w-full p-3 pl-4 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className={`font-mono text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${TONE_VERDICT_BADGE[tone]}`}
          >
            {finding.verdict}
          </span>
          <SeverityBadge severity={finding.severity} />
        </div>
        <p className="mt-1 text-sm leading-snug">{finding.summary}</p>
        {(finding.flags ?? []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(finding.flags ?? []).map((fl) => (
              <span
                key={fl}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[color-mix(in_oklab,var(--cc-warn,#d18700)_15%,transparent)] text-[var(--cc-warn,#d18700)]"
              >
                <span aria-hidden>⚠</span>
                {fl}
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <ConfidenceRing pct={pct} color={TONE_RING[tone]} />
          {finding.evidence_ids.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{finding.evidence_ids.length} evidence</span>
            </>
          )}
        </div>
      </button>
    </div>
  );
}

/** Compact circular confidence gauge. */
function ConfidenceRing({ pct, color }: { pct: number; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`confidence ${pct}%`}
      aria-label={`confidence ${pct}%`}
    >
      <span
        aria-hidden
        className="size-4 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${color} ${pct * 3.6}deg, color-mix(in oklab, ${color} 18%, transparent) 0)`,
          WebkitMask: "radial-gradient(circle 5px, transparent 62%, black 64%)",
          mask: "radial-gradient(circle 5px, transparent 62%, black 64%)",
        }}
      />
      <span className="font-mono tabular-nums text-foreground">{pct}%</span>
    </span>
  );
}
