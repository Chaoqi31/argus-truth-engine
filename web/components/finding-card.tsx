"use client";

import type { Claim, Evidence, Finding, FindingReview, ReviewerStatus } from "@/lib/types";
import { SeverityBadge } from "@/components/severity-badge";
import { verdictTone } from "@/lib/colors";

interface Props {
  finding: Finding;
  claim?: Claim | null;
  evidences?: Evidence[];
  review?: FindingReview | null;
  active: boolean;
  onClick: () => void;
  onOpenDrawer: () => void;
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

const REVIEW_LABEL: Record<ReviewerStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  disputed: "Disputed",
  "needs-recheck": "Needs recheck",
  resolved: "Resolved",
};

const REVIEW_BADGE: Record<ReviewerStatus, string> = {
  open: "bg-muted text-muted-foreground",
  accepted: "bg-success/15 text-success",
  disputed: "bg-destructive/15 text-destructive-foreground",
  "needs-recheck": "bg-warning/15 text-warning-foreground",
  resolved: "bg-primary/10 text-primary",
};

const SKEPTIC_LABEL = {
  no_counterevidence: "Skeptic cleared",
  counterevidence_found: "Skeptic challenged",
  inconclusive: "Skeptic inconclusive",
} as const;

const SKEPTIC_BADGE = {
  no_counterevidence: "bg-success/10 text-success",
  counterevidence_found: "bg-warning/15 text-warning-foreground",
  inconclusive: "bg-muted text-muted-foreground",
} as const;

/**
 * Finding card — light cockpit treatment.
 *
 * Keeps the existing button semantics + onClick contract (FindingsTab passes
 * `onClick` to select the finding). Subtle border/shadow hover lift and a small
 * confidence ring — no neon glow.
 */
export function FindingCard({
  finding,
  claim,
  evidences = [],
  review,
  active,
  onClick,
  onOpenDrawer,
}: Props) {
  const tone = verdictTone[finding.verdict];
  const pct = Math.round(finding.confidence * 100);
  const reasoningCount = finding.reasoning_chain?.length ?? 0;
  const sourceCount = evidences.length || finding.evidence_ids.length;
  const why = finding.why_wrong || finding.summary;
  const reviewStatus = review?.status ?? "open";
  const skepticStatus = finding.skeptic_review?.status ?? null;

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
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${REVIEW_BADGE[reviewStatus]}`}
          >
            {REVIEW_LABEL[reviewStatus]}
          </span>
          {skepticStatus && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${SKEPTIC_BADGE[skepticStatus]}`}
              title={finding.skeptic_review?.summary}
            >
              {SKEPTIC_LABEL[skepticStatus]}
            </span>
          )}
        </div>
        {claim?.text && (
          <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {claim.text}
          </p>
        )}
        <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-foreground">
          {finding.summary}
        </p>
        {why !== finding.summary && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {why}
          </p>
        )}
        {finding.correct_information?.value && (
          <div className="mt-2 rounded-md bg-muted px-2 py-1.5">
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Correct
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-foreground">
              {finding.correct_information.value}
            </p>
          </div>
        )}
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
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <ConfidenceRing pct={pct} color={TONE_RING[tone]} />
          <span aria-hidden>·</span>
          <span>{sourceCount} source{sourceCount === 1 ? "" : "s"}</span>
          {reasoningCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{reasoningCount} reasoning step{reasoningCount === 1 ? "" : "s"}</span>
            </>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open finding details"
        title="Open details"
        className="absolute bottom-2 right-2 z-10 grid size-6 place-items-center rounded-md border border-transparent text-muted-foreground/70 transition-all hover:border-border hover:bg-background hover:text-foreground hover:shadow-[var(--shadow-card)] focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
          <rect x="1.6" y="2.6" width="10.8" height="8.8" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9 2.6v8.8" stroke="currentColor" strokeWidth="1.4" />
        </svg>
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
