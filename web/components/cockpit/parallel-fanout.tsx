"use client";

/**
 * ParallelFanout — "N claims verified in parallel" console.
 *
 * Prop-driven, self-contained replay visualization of a completed audit.
 * Each claim gets one swim-lane that shows its trace phases (thinking →
 * web_search → fetch_url_content → verdict) as a mini progress strip and
 * ends with a verdict badge.  All lanes enter near-simultaneously with a
 * small stagger so the viewer perceives "they all ran in parallel".
 *
 * Contract:
 *   <ParallelFanout job={job} />
 *
 * Motion: uses motion/react (already a project dep). Respects
 * useReducedMotion — when reduced, lanes render statically with no stagger,
 * no phase-dot pulses.
 */

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { stepIcon, verdictTone } from "@/lib/colors";
import type { FindingVerdict, Job, ReasoningTrace, Step, StepType } from "@/lib/types";

// ---------------------------------------------------------------------------
// Phase pipeline — the ordered stages we collapse steps into.
// ---------------------------------------------------------------------------

const PHASES: StepType[] = ["thinking", "web_search", "fetch_url_content", "message"];

const PHASE_LABEL: Record<StepType, string> = {
  thinking: "Think",
  web_search: "Search",
  fetch_url_content: "Fetch",
  message: "Verdict",
  execute_python: "Python",
  execute_command: "Shell",
  tool_call: "Tool",
};

// ---------------------------------------------------------------------------
// Derived type for a single lane.
// ---------------------------------------------------------------------------

interface Lane {
  traceId: string;
  claimText: string;
  /** Which of PHASES are present in this trace (set). */
  presentPhases: Set<StepType>;
  /** How many steps total (density signal). */
  stepCount: number;
  verdict: FindingVerdict | null;
}

// ---------------------------------------------------------------------------
// Tone helpers (mirrored from reasoning-replay.tsx, kept local).
// ---------------------------------------------------------------------------

type Tone = "danger" | "warn" | "ok" | "muted";

function toneColor(tone: Tone): string {
  switch (tone) {
    case "danger": return "var(--cc-danger)";
    case "warn":   return "var(--cc-warn)";
    case "ok":     return "var(--cc-ok)";
    default:       return "var(--cc-text-muted)";
  }
}

function toneTint(tone: Tone): string {
  switch (tone) {
    case "danger": return "rgba(229,72,77,0.12)";
    case "warn":   return "rgba(217,119,6,0.12)";
    case "ok":     return "rgba(20,158,97,0.12)";
    default:       return "rgba(104,107,130,0.10)";
  }
}

function toneBorder(tone: Tone): string {
  switch (tone) {
    case "danger": return "rgba(229,72,77,0.35)";
    case "warn":   return "rgba(217,119,6,0.35)";
    case "ok":     return "rgba(20,158,97,0.35)";
    default:       return "var(--cc-border)";
  }
}

// ---------------------------------------------------------------------------
// Derive lanes from a completed job.
// ---------------------------------------------------------------------------

function buildLanes(job: Job): Lane[] {
  const claimById = new Map(job.claims.map((c) => [c.id, c]));
  const findingByTraceId = new Map(
    job.findings.map((f) => [f.reasoning_trace_id, f]),
  );

  return job.traces
    .filter((t) => t.steps.length > 0)
    .map((trace: ReasoningTrace): Lane => {
      const claim = claimById.get(trace.claim_id);
      const finding = findingByTraceId.get(trace.id);

      const presentPhases = new Set<StepType>(
        trace.steps.map((s: Step) => s.type),
      );
      // Ensure "message" (verdict) phase is shown when a final verdict step exists.
      if (trace.final_verdict_step_id) presentPhases.add("message");

      return {
        traceId: trace.id,
        claimText: claim?.text ?? `Claim ${trace.claim_id.slice(0, 8)}`,
        presentPhases,
        stepCount: trace.steps.length,
        verdict: finding?.verdict ?? null,
      };
    });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ParallelFanout({ job }: { job: Job | null }) {
  const reduceMotion = useReducedMotion() ?? false;
  const lanes = useMemo(() => (job ? buildLanes(job) : []), [job]);

  if (!job || lanes.length === 0) {
    return <EmptyState />;
  }

  return (
    <section
      aria-label="Parallel claim verification console"
      className="flex flex-col gap-3"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="size-2 rounded-full bg-[var(--cc-primary-bright)]"
          style={{ boxShadow: "var(--cc-glow-hover)" }}
        />
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
          {lanes.length} claim{lanes.length !== 1 ? "s" : ""} verified in parallel
        </p>
      </div>

      {/* Swim-lane grid */}
      <div className="flex flex-col gap-1.5">
        {lanes.map((lane, idx) => (
          <SwimLane
            key={lane.traceId}
            lane={lane}
            index={idx}
            total={lanes.length}
            reduceMotion={reduceMotion}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Individual swim lane
// ---------------------------------------------------------------------------

function SwimLane({
  lane,
  index,
  total,
  reduceMotion,
}: {
  lane: Lane;
  index: number;
  total: number;
  reduceMotion: boolean;
}) {
  const tone = lane.verdict ? verdictTone[lane.verdict] : "muted";

  // Stagger: all lanes enter within a ~180 ms window so they feel concurrent.
  // Max delay is 180 ms regardless of how many lanes there are.
  const staggerDelay = reduceMotion
    ? 0
    : total > 1
      ? (index / (total - 1)) * 0.18
      : 0;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.36, ease: [0.22, 1, 0.36, 1], delay: staggerDelay }
      }
      className="cc-glass flex min-h-[2.75rem] items-center gap-3 rounded-xl border border-[var(--cc-border)] px-3.5 py-2.5"
      style={{ boxShadow: "var(--cc-glow)" }}
    >
      {/* Claim text — constrained to ~40% width */}
      <p
        className="min-w-0 flex-[2] truncate text-xs text-[var(--cc-text)]"
        title={lane.claimText}
      >
        {lane.claimText}
      </p>

      {/* Phase strip */}
      <PhaseStrip
        phases={PHASES}
        present={lane.presentPhases}
        stepCount={lane.stepCount}
        reduceMotion={reduceMotion}
        staggerDelay={staggerDelay}
      />

      {/* Verdict badge */}
      <VerdictBadge verdict={lane.verdict} tone={tone} />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Phase strip — a row of phase dots/icons
// ---------------------------------------------------------------------------

function PhaseStrip({
  phases,
  present,
  stepCount,
  reduceMotion,
  staggerDelay,
}: {
  phases: StepType[];
  present: Set<StepType>;
  stepCount: number;
  reduceMotion: boolean;
  staggerDelay: number;
}) {
  return (
    <div
      className="flex flex-none items-center gap-0"
      aria-label={`${stepCount} steps`}
      title={`${stepCount} steps`}
    >
      {phases.map((phase, i) => {
        const active = present.has(phase);
        // Dots animate in with a brief cascade within the lane's own entry delay.
        const dotDelay = reduceMotion ? 0 : staggerDelay + i * 0.045;

        return (
          <div key={phase} className="flex items-center">
            {/* Connecting line between dots */}
            {i > 0 && (
              <div
                aria-hidden
                className="h-px w-4"
                style={{
                  backgroundColor: active
                    ? "var(--cc-primary-bright)"
                    : "var(--cc-border)",
                  opacity: active ? 0.5 : 0.3,
                }}
              />
            )}

            {/* Phase dot / icon chip */}
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
              animate={
                active
                  ? { opacity: 1, scale: 1 }
                  : { opacity: 0.28, scale: 1 }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      duration: 0.28,
                      ease: [0.22, 1, 0.36, 1],
                      delay: dotDelay,
                    }
              }
              title={PHASE_LABEL[phase]}
              aria-label={`${PHASE_LABEL[phase]}: ${active ? "completed" : "not run"}`}
              className="relative grid place-items-center rounded-full text-[9px] leading-none"
              style={{
                width: 22,
                height: 22,
                backgroundColor: active
                  ? "color-mix(in oklab, var(--cc-primary) 16%, transparent)"
                  : "transparent",
                border: active
                  ? "1px solid var(--cc-border-glow)"
                  : "1px solid var(--cc-border)",
              }}
            >
              {/* Sonar ping on the last active phase (the "live" indicator). */}
              {active && phase === "message" && !reduceMotion && (
                <span
                  aria-hidden
                  className="cc-pulse-glow pointer-events-none absolute inset-0 rounded-full"
                  style={{
                    backgroundColor:
                      "color-mix(in oklab, var(--cc-primary) 32%, transparent)",
                  }}
                />
              )}
              <span aria-hidden>{stepIcon[phase]}</span>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verdict badge
// ---------------------------------------------------------------------------

function VerdictBadge({
  verdict,
  tone,
}: {
  verdict: FindingVerdict | null;
  tone: Tone;
}) {
  if (!verdict) {
    return (
      <span className="flex-none font-mono text-[10px] text-[var(--cc-text-muted)] opacity-40">
        —
      </span>
    );
  }

  return (
    <span
      className="flex-none rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{
        color: toneColor(tone),
        backgroundColor: toneTint(tone),
        border: `1px solid ${toneBorder(tone)}`,
      }}
    >
      {verdict}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2.5 py-8 text-center">
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-xl text-lg"
        style={{
          backgroundColor: "rgba(113,50,245,0.10)",
          border: "1px solid var(--cc-border-glow)",
        }}
      >
        {stepIcon.thinking}
      </span>
      <p className="text-sm font-medium text-[var(--cc-text)]">
        No traces to display
      </p>
      <p className="max-w-xs text-xs leading-relaxed text-[var(--cc-text-muted)]">
        Complete an audit to see all claims verified in parallel here.
      </p>
    </div>
  );
}
