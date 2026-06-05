"use client";

import type { Claim, Evidence, Finding, FindingReview, ReviewerStatus } from "@/lib/types";
import { SeverityBadge } from "@/components/severity-badge";
import { verdictTone } from "@/lib/colors";
import { isDerivedFinding } from "@/lib/findings";

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
  const derived = isDerivedFinding(finding);
  const sourceLabel =
    sourceCount > 0
      ? `${sourceCount} source${sourceCount === 1 ? "" : "s"}`
      : derived
        ? "derived finding"
        : "no cited sources";
  const why = finding.why_wrong || finding.summary;
  const reviewStatus = review?.status ?? "open";
  const skepticStatus = finding.skeptic_review?.status ?? null;
  const bodyPadding = active ? "p-3 pl-4" : "p-2.5 pl-4";

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-[var(--radius-card)] border bg-background transition-[transform,border-color,box-shadow,background-color] duration-300 ease-enter will-change-transform hover:-translate-y-1 hover:scale-[1.003] hover:bg-primary/5 hover:shadow-[0_16px_42px_rgba(16,24,40,0.12)] motion-reduce:transform-none motion-reduce:transition-none ${
        active
          ? "border-primary shadow-[0_16px_46px_rgba(113,50,245,0.15)]"
          : "border-border shadow-sm hover:border-primary/35"
      }`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-primary/70 transition-transform duration-500 ease-enter group-hover:scale-x-100 motion-reduce:hidden"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-y-8 -left-1/3 w-1/3 rotate-12 bg-gradient-to-r from-transparent via-primary/10 to-transparent opacity-0 transition-[transform,opacity] duration-500 ease-enter group-hover:translate-x-[430%] group-hover:opacity-100 motion-reduce:hidden"
      />
      {/* Vertical accent bar coloured by verdict tone */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 transition-[width,opacity] duration-300 ease-enter group-hover:w-1.5 ${TONE_BAR[tone]}`}
      />

      {/* Body — the primary click target selects the finding. */}
      <button
        type="button"
        onClick={onClick}
        className={`relative block w-full ${bodyPadding} text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset`}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className={`font-mono text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded transition-transform duration-300 ease-enter group-hover:scale-105 motion-reduce:transform-none ${TONE_VERDICT_BADGE[tone]}`}
          >
            {finding.verdict}
          </span>
          <SeverityBadge severity={finding.severity} className="transition-[transform,box-shadow] duration-300 ease-enter group-hover:scale-105 group-hover:shadow-[0_8px_18px_rgba(16,24,40,0.08)] motion-reduce:transform-none" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-transform duration-300 ease-enter group-hover:-translate-y-0.5 motion-reduce:transform-none ${REVIEW_BADGE[reviewStatus]}`}
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
          {derived && (
            <span
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
              title={`${finding.agent} finding derived from pipeline outputs`}
            >
              Derived
            </span>
          )}
        </div>
        {claim?.text && (
          <p className={`mt-2 text-[13px] font-medium leading-snug text-foreground transition-colors duration-300 ease-enter group-hover:text-primary ${active ? "line-clamp-2" : "line-clamp-1"}`}>
            {claim.text}
          </p>
        )}
        <p className={`mt-1.5 text-sm leading-snug text-foreground transition-colors duration-300 ease-enter group-hover:text-foreground/90 ${active ? "line-clamp-2" : "line-clamp-1"}`}>
          {finding.summary}
        </p>
        {active && why !== finding.summary && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {why}
          </p>
        )}
        {active && finding.correct_information?.value && (
          <div className="mt-2 rounded-md bg-muted px-2 py-1.5 transition-[background-color,box-shadow] duration-300 ease-enter group-hover:bg-primary/5 group-hover:shadow-[inset_0_0_0_1px_rgba(113,50,245,0.14)]">
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Correct
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-foreground">
              {finding.correct_information.value}
            </p>
          </div>
        )}
        {active && (finding.flags ?? []).length > 0 && (
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
          <span>{sourceLabel}</span>
          {active && reasoningCount > 0 && (
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
        className="absolute bottom-2 right-2 z-10 grid size-6 place-items-center rounded-md border border-transparent text-muted-foreground/70 opacity-70 transition-[transform,opacity,border-color,background-color,color,box-shadow] duration-300 ease-enter hover:-translate-y-0.5 hover:border-primary/30 hover:bg-background hover:text-primary hover:shadow-[var(--shadow-card)] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none"
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
      className="inline-flex items-center gap-1.5 transition-transform duration-300 ease-enter group-hover:scale-105 motion-reduce:transform-none"
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
