"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useArgusStore } from "@/lib/store";
import type { Claim, Evidence, Finding, FindingVerdict } from "@/lib/types";
import { safeHttpUrl } from "@/lib/url";
import { verdictColorVar } from "@/lib/colors";
import { CloseIcon } from "@/components/icons";

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

/**
 * Tokenise a string into words (preserving spaces/punctuation as their own
 * tokens so the output can be re-joined losslessly).
 */
function tokenise(text: string): string[] {
  return text.split(/(\s+|[,;.!?:"""''()\[\]{}])/).filter(Boolean);
}

type DiffKind = "same" | "removed" | "added";

interface DiffToken {
  text: string;
  kind: DiffKind;
}

/**
 * Naive LCS-based word diff between two token arrays.  Returns two parallel
 * sequences (left = claim side, right = evidence side) each annotated with
 * "same" | "removed" | "added".  Used only for visual emphasis — correctness
 * is secondary to speed, so we keep it simple.
 */
function diffTokens(
  aTokens: string[],
  bTokens: string[]
): { left: DiffToken[]; right: DiffToken[] } {
  const m = aTokens.length;
  const n = bTokens.length;

  // Build LCS length table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aTokens[i - 1].toLowerCase() === bTokens[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Back-track
  const left: DiffToken[] = [];
  const right: DiffToken[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aTokens[i - 1].toLowerCase() === bTokens[j - 1].toLowerCase()) {
      left.unshift({ text: aTokens[i - 1], kind: "same" });
      right.unshift({ text: bTokens[j - 1], kind: "same" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      right.unshift({ text: bTokens[j - 1], kind: "added" });
      j--;
    } else {
      left.unshift({ text: aTokens[i - 1], kind: "removed" });
      i--;
    }
  }
  return { left, right };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffPane({
  tokens,
  side,
  label,
}: {
  tokens: DiffToken[];
  side: "claim" | "evidence";
  label: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 min-w-0">
      <p
        style={{ color: "var(--cc-text-muted)", fontFamily: "var(--font-mono)" }}
        className="text-[10px] uppercase tracking-widest"
      >
        {label}
      </p>
      <div
        style={{
          background: "var(--cc-bg)",
          border: "1px solid var(--cc-border)",
          borderRadius: "10px",
        }}
        className="flex-1 overflow-y-auto p-5 text-sm leading-relaxed"
      >
        {tokens.map((token, idx) => {
          if (token.kind === "same") {
            return (
              <span key={idx} style={{ color: "var(--cc-text)" }}>
                {token.text}
              </span>
            );
          }
          if (token.kind === "removed" && side === "claim") {
            // Highlight divergent tokens on the claim side
            return (
              <mark
                key={idx}
                style={{
                  background: "var(--cc-danger-tint)",
                  color: "var(--cc-danger)",
                  borderRadius: "3px",
                  padding: "0 2px",
                }}
              >
                {token.text}
              </mark>
            );
          }
          if (token.kind === "added" && side === "evidence") {
            // Highlight divergent tokens on the evidence side
            return (
              <mark
                key={idx}
                style={{
                  background: "var(--cc-ok-tint)",
                  color: "var(--cc-ok)",
                  borderRadius: "3px",
                  padding: "0 2px",
                }}
              >
                {token.text}
              </mark>
            );
          }
          // "removed" on evidence side or "added" on claim side — render muted
          return (
            <span key={idx} style={{ color: "var(--cc-text-muted)", opacity: 0.5 }}>
              {token.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source URL chip
// ---------------------------------------------------------------------------

function SourceChip({ evidence }: { evidence: Evidence }) {
  const safe = safeHttpUrl(evidence.url);
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        color: "var(--cc-primary-bright)",
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        border: "1px solid var(--cc-border)",
        borderRadius: "6px",
        padding: "4px 10px",
        background: "color-mix(in oklab, var(--cc-primary) 6%, transparent)",
        textDecoration: "none",
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--cc-border-glow)";
        (e.currentTarget as HTMLAnchorElement).style.background =
          "color-mix(in oklab, var(--cc-primary) 14%, transparent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--cc-border)";
        (e.currentTarget as HTMLAnchorElement).style.background =
          "color-mix(in oklab, var(--cc-primary) 6%, transparent)";
      }}
    >
      <span aria-hidden style={{ opacity: 0.7 }}>&#8599;</span>
      <span
        style={{
          maxWidth: "44ch",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {evidence.citation || evidence.url}
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Verdict badge
// ---------------------------------------------------------------------------

function VerdictBadge({ verdict }: { verdict: string }) {
  const color = verdictColorVar(verdict as FindingVerdict);
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: "4px",
        padding: "2px 7px",
        opacity: 0.9,
      }}
    >
      {verdict}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * EvidenceDiff — light, solid right-side panel (mirrors FindingDrawer).
 *
 * Reads `evidenceDiff` from the store.  When non-null, slides a light `.cc-glass`
 * panel in from the right (the DAG/console stays visible beside it) and renders a
 * side-by-side diff of the claim text (left) and the source snippet (right), with
 * word-level highlighting of differences.  The source URL is clickable.
 *
 * Close: Escape key or click the scrim / Close button (`setEvidenceDiff(null)`).
 */
export function EvidenceDiff() {
  const evidenceDiff = useArgusStore((s) => s.evidenceDiff);
  const setEvidenceDiff = useArgusStore((s) => s.setEvidenceDiff);
  const job = useArgusStore((s) => s.job);
  const shouldReduceMotion = useReducedMotion();

  // Resolve data
  const finding: Finding | null =
    job?.findings.find((f) => f.id === evidenceDiff?.findingId) ?? null;
  const claim: Claim | null =
    (finding && job?.claims.find((c) => c.id === finding.claim_id)) ?? null;
  const evidence: Evidence | null =
    (job && evidenceDiff && job.evidences.find((e) => e.id === evidenceDiff.evidenceId)) ?? null;

  const open = evidenceDiff !== null;

  // Close on Esc (scrim click + ✕ are wired on their elements).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEvidenceDiff(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setEvidenceDiff]);

  // Compute diff tokens when both sides are available
  const diff =
    claim && evidence
      ? diffTokens(tokenise(claim.text), tokenise(evidence.snippet))
      : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Scrim — dims the cockpit canvas; click to close. */}
          <button
            type="button"
            aria-label="Close evidence comparison"
            onClick={() => setEvidenceDiff(null)}
            className="absolute inset-0 bg-[#101114]/40"
          />

          {/* Panel */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Evidence comparison"
            className="cc-glass relative flex h-full w-full max-w-[540px] flex-col border-l border-[var(--cc-border)] shadow-[var(--cc-glow)]"
            initial={shouldReduceMotion ? { x: 0 } : { x: "100%" }}
            animate={{ x: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { x: "100%" }}
            transition={
              shouldReduceMotion
                ? { duration: 0.12 }
                : { type: "spring", stiffness: 320, damping: 34 }
            }
          >
            {/* ── Header ── */}
            <header
              style={{ borderBottom: "1px solid var(--cc-border)" }}
              className="flex shrink-0 items-center justify-between gap-4 px-6 py-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--cc-text-muted)",
                  }}
                >
                  Evidence comparison
                </span>
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--cc-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "38ch",
                    }}
                  >
                    {finding ? finding.summary : "Claim vs source"}
                  </span>
                  {finding && <VerdictBadge verdict={finding.verdict} />}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEvidenceDiff(null)}
                aria-label="Close evidence comparison"
                className="shrink-0 rounded-md p-1.5 text-[var(--cc-text-muted)] transition-colors hover:bg-[var(--cc-bg)] hover:text-[var(--cc-text)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
              >
                <CloseIcon />
              </button>
            </header>

            {/* ── Source chip — clickable link to the cited source ── */}
            {evidence && (
              <div
                style={{ borderBottom: "1px solid var(--cc-border)" }}
                className="flex shrink-0 items-center px-6 py-2.5"
              >
                <SourceChip evidence={evidence} />
              </div>
            )}

            {/* ── Legend ── */}
            <div
              style={{ borderBottom: "1px solid var(--cc-border)" }}
              className="flex shrink-0 items-center gap-5 px-6 py-2"
            >
              <LegendDot color="var(--cc-danger)" label="Diverges from source" />
              <LegendDot color="var(--cc-ok)" label="Present in source" />
              <LegendDot color="var(--cc-text-muted)" label="Unchanged" />
            </div>

            {/* ── Body: two-column diff ── */}
            <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-6 py-5">
              {diff ? (
                <>
                  <DiffPane
                    tokens={diff.left}
                    side="claim"
                    label="Claim (from document)"
                  />

                  {/* Divider */}
                  <div
                    style={{ width: "1px", background: "var(--cc-border)", flexShrink: 0 }}
                  />

                  <DiffPane
                    tokens={diff.right}
                    side="evidence"
                    label={`Source snippet · ${evidence?.source_type ?? ""}`}
                  />
                </>
              ) : (
                /* Fallback: plain text if one side is missing */
                <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:gap-6">
                  {/* Left */}
                  <div className="flex flex-1 flex-col gap-3">
                    <p
                      style={{ color: "var(--cc-text-muted)", fontFamily: "var(--font-mono)" }}
                      className="text-[10px] uppercase tracking-widest"
                    >
                      Claim (from document)
                    </p>
                    <div
                      style={{
                        background: "var(--cc-bg)",
                        border: "1px solid var(--cc-border)",
                        borderRadius: "10px",
                        color: "var(--cc-text)",
                      }}
                      className="flex-1 overflow-y-auto p-5 text-sm leading-relaxed"
                    >
                      {claim?.text ?? (
                        <span style={{ color: "var(--cc-text-muted)" }}>No claim text available.</span>
                      )}
                    </div>
                  </div>

                  <div style={{ width: "1px", background: "var(--cc-border)", flexShrink: 0 }} />

                  {/* Right */}
                  <div className="flex flex-1 flex-col gap-3">
                    <p
                      style={{ color: "var(--cc-text-muted)", fontFamily: "var(--font-mono)" }}
                      className="text-[10px] uppercase tracking-widest"
                    >
                      Source snippet
                    </p>
                    <div
                      style={{
                        background: "var(--cc-bg)",
                        border: "1px solid var(--cc-border)",
                        borderRadius: "10px",
                        color: "var(--cc-text)",
                      }}
                      className="flex-1 overflow-y-auto p-5 text-sm leading-relaxed"
                    >
                      {evidence?.snippet ?? (
                        <span style={{ color: "var(--cc-text-muted)" }}>No source snippet available.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Footer: metadata row ── */}
            {evidence && (
              <footer
                style={{ borderTop: "1px solid var(--cc-border)" }}
                className="flex shrink-0 items-center gap-6 px-6 py-3"
              >
                <MetaItem label="Source type" value={evidence.source_type} />
                <MetaItem label="Retrieved" value={formatDate(evidence.retrieved_at)} />
                {claim && (
                  <MetaItem label="Claim type" value={claim.type} />
                )}
                {claim && claim.page > 0 && (
                  <MetaItem label="Page" value={String(claim.page)} />
                )}
              </footer>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: color,
          opacity: 0.8,
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--cc-text-muted)",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--cc-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--cc-text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
