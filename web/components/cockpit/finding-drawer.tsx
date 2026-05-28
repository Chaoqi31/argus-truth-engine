"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { FindingVerdict, StepType } from "@/lib/types";
import { useArgusStore } from "@/lib/store";
import { verdictTone } from "@/lib/colors";
import { SeverityBadge } from "@/components/severity-badge";
import { ConfidenceBreakdown } from "@/components/confidence-breakdown";
/**
 * Finding drawer — T2 surface.
 *
 * Reads `drawerFindingId` from the store (`null` = closed), resolves the Finding
 * from `job.findings`, and slides a dark glass panel in from the right over the
 * cockpit canvas. Body reuses the same data-fetching the evidence tab does:
 *   - reasoning chain  → job.traces[reasoning_trace_id].steps  ("why this verdict")
 *   - confidence       → <ConfidenceBreakdown breakdown={finding.confidence_breakdown}/>
 *   - evidence         → job.evidences filtered by finding.evidence_ids
 * plus the finding's verdict rationale (`finding.summary`).
 *
 * Contract (kept in sync with page wiring + store):
 *   - close via `setDrawerFinding(null)` (scrim click, ✕, or Esc);
 *   - "Replay reasoning" hands off via `setReplayOpen(true, drawerFindingId)`;
 *   - clicking an evidence item opens the full-screen compare surface via
 *     `setEvidenceDiff({ findingId, evidenceId })` (rendered by <EvidenceDiff/>).
 */

/** Verdict tone → cockpit colour token (fallbacks keep it sane in light mode). */
const TONE_COLOR: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "var(--cc-danger, #d92d20)",
  warn: "var(--cc-warn, #d18700)",
  ok: "var(--cc-ok, #149e61)",
  muted: "var(--cc-text-muted, #9497a9)",
};

/** Short typographic tags for trace step types (no emoji, terminal aesthetic). */
const STEP_TAG: Record<StepType, string> = {
  thinking: "think",
  web_search: "search",
  fetch_url_content: "fetch",
  execute_python: "python",
  execute_command: "exec",
  tool_call: "tool",
  message: "note",
};

export function FindingDrawer() {
  const drawerFindingId = useArgusStore((s) => s.drawerFindingId);
  const setDrawerFinding = useArgusStore((s) => s.setDrawerFinding);
  const setReplayOpen = useArgusStore((s) => s.setReplayOpen);
  const setEvidenceDiff = useArgusStore((s) => s.setEvidenceDiff);
  const job = useArgusStore((s) => s.job);
  const reduceMotion = useReducedMotion();

  const finding = job?.findings.find((f) => f.id === drawerFindingId) ?? null;
  const open = drawerFindingId !== null;

  // Close on Esc (scrim click + ✕ are wired on their elements).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerFinding(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setDrawerFinding]);

  // Same lookups the evidence tab uses, against the loaded job.
  const claim = job?.claims.find((c) => c.id === finding?.claim_id) ?? null;
  const trace = job?.traces.find((t) => t.id === finding?.reasoning_trace_id) ?? null;
  const evidences =
    job && finding
      ? job.evidences.filter((e) => finding.evidence_ids.includes(e.id))
      : [];

  const tone: "danger" | "warn" | "ok" | "muted" = finding
    ? verdictTone[finding.verdict as FindingVerdict]
    : "muted";
  const toneColor = TONE_COLOR[tone];
  const confidencePct = finding ? Math.round(finding.confidence * 100) : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Scrim — dims the cockpit canvas; click to close. */}
          <button
            type="button"
            aria-label="Close finding details"
            onClick={() => setDrawerFinding(null)}
            className="absolute inset-0 bg-[#101114]/40"
          />

          {/* Panel */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Finding details"
            className="cc-glass relative flex h-full w-full max-w-[460px] flex-col border-l border-[var(--cc-border)] shadow-[var(--cc-glow)]"
            initial={reduceMotion ? { x: 0 } : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: "100%" }}
            transition={
              reduceMotion
                ? { duration: 0.12 }
                : { type: "spring", stiffness: 320, damping: 34 }
            }
          >
            {/* Header: agent · verdict + glowing tone dot · close */}
            <header className="flex items-center justify-between gap-3 border-b border-[var(--cc-border)] px-5 py-3.5">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--cc-text-muted)]">
                  {finding?.agent ?? "finding"}
                </p>
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--cc-text)]">
                  <span
                    aria-hidden
                    className="cc-status-dot inline-block size-2 shrink-0 rounded-full"
                    style={{ color: toneColor, backgroundColor: toneColor }}
                  />
                  <span className="truncate font-mono">{finding?.verdict ?? "—"}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerFinding(null)}
                aria-label="Close"
                className="rounded-md p-1.5 text-[var(--cc-text-muted)] transition-colors hover:bg-[var(--cc-bg)] hover:text-[var(--cc-text)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
              >
                <CloseIcon />
              </button>
            </header>

            {/* Scrollable body */}
            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {!finding ? (
                <p className="text-sm text-[var(--cc-text-muted)]">
                  This finding is no longer available.
                </p>
              ) : (
                <>
                  {/* Verdict · severity · confidence summary line */}
                  <section className="relative flex flex-wrap items-center gap-2.5">
                    {/* Verdict neon bloom — oversized blurred radial behind the
                        verdict pill, tinted by tone. Resting/static (no flicker);
                        sits below content (-z-0) so it never blocks clicks. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -inset-x-8 -inset-y-10 -z-0 rounded-full"
                      style={{
                        background: `radial-gradient(60% 70% at 18% 50%, color-mix(in oklab, ${toneColor} 40%, transparent) 0%, color-mix(in oklab, ${toneColor} 14%, transparent) 38%, transparent 72%)`,
                        filter: "blur(26px)",
                        opacity: reduceMotion ? 0.45 : 0.6,
                      }}
                    />
                    <span
                      className="relative inline-flex items-center rounded-full px-2.5 py-1 font-mono text-xs font-semibold ring-1 ring-inset"
                      style={{
                        color: toneColor,
                        backgroundColor: `color-mix(in oklab, ${toneColor} 14%, transparent)`,
                        boxShadow: "none",
                      }}
                    >
                      {finding.verdict}
                    </span>
                    <SeverityBadge severity={finding.severity} />
                    <span
                      className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-[var(--cc-text-muted)]"
                      title={`confidence ${confidencePct}%`}
                    >
                      <ConfidenceRing pct={confidencePct} color={toneColor} />
                      <span className="tabular-nums text-[var(--cc-text)]">
                        {confidencePct}%
                      </span>
                    </span>
                  </section>

                  {/* Claim under audit */}
                  <Section label="Claim">
                    <p className="text-sm leading-relaxed text-[var(--cc-text)]">
                      {claim?.text ?? "(claim text unavailable)"}
                    </p>
                    {claim && claim.page > 0 && (
                      <p className="mt-1 font-mono text-[11px] text-[var(--cc-text-muted)]">
                        page {claim.page}
                      </p>
                    )}
                  </Section>

                  {/* Verdict rationale (the finding's narrative) */}
                  <Section label="What's wrong">
                    <p className="text-sm leading-relaxed text-[var(--cc-text)]">
                      {finding.summary}
                    </p>
                  </Section>

                  {/* Reasoning chain — "why this verdict" (trace steps) */}
                  <Section label="Why this verdict">
                    {trace && trace.steps.length > 0 ? (
                      <ol className="relative space-y-0">
                        {trace.steps.map((s, i) => (
                          <li
                            key={s.id}
                            className="relative flex gap-3 pb-3 pl-1 last:pb-0"
                          >
                            {/* connecting rail */}
                            {i < trace.steps.length - 1 && (
                              <span
                                aria-hidden
                                className="absolute left-[7px] top-4 bottom-0 w-px bg-[var(--cc-border)]"
                              />
                            )}
                            <span
                              aria-hidden
                              className="relative mt-1 size-[14px] shrink-0 rounded-full border border-[var(--cc-border)] bg-[var(--cc-bg)]"
                            >
                              <span
                                className="absolute inset-[3px] rounded-full"
                                style={{
                                  backgroundColor:
                                    "color-mix(in oklab, var(--cc-primary, #7132f5) 70%, transparent)",
                                }}
                              />
                            </span>
                            <div className="min-w-0">
                              <span className="mr-2 font-mono text-[9px] uppercase tracking-wider text-[var(--cc-primary-bright)]">
                                {STEP_TAG[s.type]}
                              </span>
                              <span className="text-sm leading-snug text-[var(--cc-text)]">
                                {s.summary}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-[var(--cc-text-muted)]">
                        No reasoning steps recorded for this finding.
                      </p>
                    )}
                  </Section>

                  {/* Confidence breakdown — glowing animated bars (shared cmp) */}
                  {finding.confidence_breakdown && (
                    <Section label="Confidence breakdown">
                      <ConfidenceBreakdown breakdown={finding.confidence_breakdown} />
                    </Section>
                  )}

                  {/* Evidence — each row opens the compare surface; URL clickable */}
                  <Section label={`Evidence (${evidences.length})`}>
                    {evidences.length > 0 ? (
                      <ul className="space-y-2">
                        {evidences.map((e) => (
                          <li key={e.id}>
                            <div className="group rounded-[10px] border border-[var(--cc-border)] bg-[var(--cc-bg)] transition-colors hover:border-[var(--cc-primary)]">
                              <button
                                type="button"
                                onClick={() =>
                                  setEvidenceDiff({
                                    findingId: finding.id,
                                    evidenceId: e.id,
                                  })
                                }
                                aria-label={`Compare claim against ${e.citation}`}
                                className="w-full rounded-[10px] px-3 py-2.5 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--cc-text-muted)]">
                                    {e.source_type}
                                  </span>
                                  <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--cc-primary-bright)] opacity-0 transition-opacity group-hover:opacity-100">
                                    compare
                                  </span>
                                </div>
                                <p className="mt-1 text-sm font-medium text-[var(--cc-text)]">
                                  {e.citation}
                                </p>
                                {e.snippet && (
                                  <p className="mt-1 line-clamp-3 text-xs leading-snug text-[var(--cc-text-muted)]">
                                    {e.snippet}
                                  </p>
                                )}
                              </button>
                              {e.url && (
                                <div className="border-t border-[var(--cc-border)] px-3 py-1.5">
                                  <a
                                    href={e.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--cc-primary-bright)] underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
                                  >
                                    <ExternalIcon />
                                    <span className="truncate">{e.url}</span>
                                  </a>
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-[var(--cc-text-muted)]">
                        No external evidence — this is an internal-consistency finding.
                      </p>
                    )}
                  </Section>
                </>
              )}
            </div>

            {/* Footer: hand off to the cinematic replay */}
            <footer className="border-t border-[var(--cc-border)] px-5 py-3">
              <button
                type="button"
                onClick={() => setReplayOpen(true, drawerFindingId)}
                className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white shadow-[var(--cc-glow)] transition-transform hover:-translate-y-px focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary-bright)]"
              >
                <PlayIcon />
                Replay reasoning
              </button>
            </footer>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Labelled body section with the cockpit's mono micro-heading. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-mono text-[10px] uppercase tracking-wider text-[var(--cc-text-muted)]">
        {label}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Compact circular confidence gauge (mirrors the finding-card ring). */
function ConfidenceRing({ pct, color }: { pct: number; color: string }) {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded-full"
      style={{
        background: `conic-gradient(${color} ${pct * 3.6}deg, color-mix(in oklab, ${color} 18%, transparent) 0)`,
        WebkitMask: "radial-gradient(circle 5px, transparent 62%, black 64%)",
        mask: "radial-gradient(circle 5px, transparent 62%, black 64%)",
      }}
    />
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3 3l8 8M11 3l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor" aria-hidden>
      <path d="M1 1.2v9.6a.6.6 0 0 0 .92.5l7.7-4.8a.6.6 0 0 0 0-1l-7.7-4.8A.6.6 0 0 0 1 1.2Z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M4.5 2.5H2.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2M7 1.5h3.5V5M10.5 1.5L5 7"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
