"use client";

import { useRef, useState } from "react";
import type { Finding } from "@/lib/types";
import { SeverityBadge } from "@/components/severity-badge";
import { verdictTone } from "@/lib/colors";

interface Props {
  finding: Finding;
  active: boolean;
  onClick: () => void;
  /** Open the cinematic reasoning replay for this finding (per-card entry). */
  onReplay?: () => void;
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
 * Premium finding card — dark cockpit treatment.
 *
 * Keeps the existing button semantics + onClick contract (FindingsTab passes
 * `onClick` to select the finding). Adds a pointer-following spotlight glow on
 * hover (SpotlightCard aesthetic, self-contained so the <button> stays the only
 * interactive element) and a small confidence ring.
 */
export function FindingCard({ finding, active, onClick, onReplay }: Props) {
  const tone = verdictTone[finding.verdict];
  const ref = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ x: number; y: number; on: boolean }>({
    x: 0,
    y: 0,
    on: false,
  });
  const pct = Math.round(finding.confidence * 100);

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        setSpot({ x: e.clientX - r.left, y: e.clientY - r.top, on: true });
      }}
      onMouseLeave={() => setSpot((s) => ({ ...s, on: false }))}
      className={`group relative w-full overflow-hidden rounded-[var(--radius-card)] border bg-background shadow-[var(--shadow-card)] transition-all hover:-translate-y-px hover:shadow-[var(--shadow-card-hover)] ${
        active ? "border-primary" : "border-border hover:border-border-strong"
      }`}
    >
      {/* Pointer-following spotlight glow (subtle on the light theme). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          opacity: spot.on ? undefined : 0,
          background: `radial-gradient(220px circle at ${spot.x}px ${spot.y}px, var(--cc-border-glow, transparent), transparent 70%)`,
        }}
      />

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
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <ConfidenceRing pct={pct} color={TONE_RING[tone]} />
          <span className="font-mono text-[10px] text-muted-foreground">{finding.agent}</span>
          {finding.evidence_ids.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{finding.evidence_ids.length} evidence</span>
            </>
          )}
        </div>
      </button>

      {/* Prominent per-card entry into the cinematic reasoning replay. */}
      {onReplay && (
        <div className="relative border-t border-border px-3 py-2 pl-4">
          <button
            type="button"
            onClick={onReplay}
            aria-label="Replay reasoning for this finding"
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary-soft px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary hover:text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          >
            <PlayIcon />
            Replay reasoning
          </button>
        </div>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="11" viewBox="0 0 11 12" fill="currentColor" aria-hidden className="shrink-0">
      <path d="M1 1.2v9.6a.6.6 0 0 0 .92.5l7.7-4.8a.6.6 0 0 0 0-1l-7.7-4.8A.6.6 0 0 0 1 1.2Z" />
    </svg>
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
