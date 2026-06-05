"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useArgusStore } from "@/lib/store";
import { verdictColorVar } from "@/lib/colors";
import { SeverityBadge } from "@/components/severity-badge";
import { ConfidenceBreakdown } from "@/components/confidence-breakdown";
import { CloseIcon } from "@/components/icons";
import { safeHttpUrl } from "@/lib/url";
/**
 * Finding drawer — T2 surface.
 *
 * Reads `drawerFindingId` from the store (`null` = closed), resolves the Finding
 * from `job.findings`, and slides a dark glass panel in from the right over the
 * cockpit canvas. It is intentionally a review dossier: claim, verdict,
 * rationale, correction, confidence and handoff links. Evidence receipts and
 * full trace steps live in their dedicated cockpit panels.
 *
 * Contract (kept in sync with page wiring + store):
 *   - close via `setDrawerFinding(null)` (scrim click, ✕, or Esc);
 *   - evidence/trace handoff buttons focus this finding and switch the console.
 */

export function FindingDrawer() {
  const drawerFindingId = useArgusStore((s) => s.drawerFindingId);
  const setDrawerFinding = useArgusStore((s) => s.setDrawerFinding);
  const setActiveFinding = useArgusStore((s) => s.setActiveFinding);
  const setConsoleMode = useArgusStore((s) => s.setConsoleMode);
  const job = useArgusStore((s) => s.job);
  const reduceMotion = useReducedMotion();

  const finding = job?.findings.find((f) => f.id === drawerFindingId) ?? null;
  const open = drawerFindingId !== null;

  const openPanel = (mode: "evidence" | "trace") => {
    if (finding) setActiveFinding(finding.id);
    setConsoleMode(mode);
    setDrawerFinding(null);
  };

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

  const toneColor = finding ? verdictColorVar(finding.verdict) : "var(--cc-text-muted, #9497a9)";
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

                  {/* Why it's wrong — plain-language explanation */}
                  {finding.why_wrong && (
                    <Section label="Why it's wrong">
                      <p className="text-sm leading-relaxed text-[var(--cc-text)]">
                        {finding.why_wrong}
                      </p>
                    </Section>
                  )}

                  {/* Correct information — the right answer with its source */}
                  {finding.correct_information && (
                    <Section label="Correct information">
                      <p className="text-sm leading-relaxed text-[var(--cc-text)]">
                        {finding.correct_information.value}
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-[11px] text-[var(--cc-text-muted)]">
                        <span className="uppercase tracking-wider">Source:</span>
                        {safeHttpUrl(finding.correct_information.url) ? (
                          <a
                            href={safeHttpUrl(finding.correct_information.url)!}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-[var(--cc-primary-bright)] underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
                          >
                            <ExternalIcon />
                            <span>{finding.correct_information.source}</span>
                          </a>
                        ) : (
                          <span>{finding.correct_information.source}</span>
                        )}
                        {finding.correct_information.retrieved_date && (
                          <span className="text-[10px] opacity-70">
                            · retrieved {finding.correct_information.retrieved_date}
                          </span>
                        )}
                      </p>
                    </Section>
                  )}

                  {/* Confidence breakdown — glowing animated bars (shared cmp) */}
                  {finding.confidence_breakdown && finding.evidence_ids.length > 0 && (
                    <Section label="Confidence breakdown">
                      <ConfidenceBreakdown breakdown={finding.confidence_breakdown} />
                    </Section>
                  )}

                  <Section label="Evidence trail">
                    <HandoffRow
                      title={`${evidences.length} cited source${evidences.length === 1 ? "" : "s"}`}
                      body={
                        evidences.length > 0
                          ? "Primary records, corroborating sources, provenance and source-quality scores."
                          : "This finding has no external-source receipts."
                      }
                      action="Show evidence"
                      onClick={() => openPanel("evidence")}
                    />
                  </Section>

                  <Section label="Reasoning trace">
                    <HandoffRow
                      title={`${trace?.steps.length ?? 0} trace step${trace?.steps.length === 1 ? "" : "s"}`}
                      body="Verifier search queries, reasoning checkpoints, fetched-source events and synthesis."
                      action="Show trace"
                      onClick={() => openPanel("trace")}
                    />
                  </Section>
                </>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HandoffRow({
  title,
  body,
  action,
  onClick,
}: {
  title: string;
  body: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--cc-border)] bg-[var(--cc-bg)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--cc-text)]">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--cc-text-muted)]">{body}</p>
        </div>
        <button
          type="button"
          onClick={onClick}
          className="shrink-0 rounded border border-[var(--cc-border)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--cc-primary-bright)] transition-colors hover:border-[var(--cc-primary)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
        >
          {action}
        </button>
      </div>
    </div>
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
