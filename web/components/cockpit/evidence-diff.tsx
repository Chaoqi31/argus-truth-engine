"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useArgusStore } from "@/lib/store";
import type { Claim, Evidence, Finding } from "@/lib/types";

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
                  background: "rgba(255,92,108,0.18)",
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
                  background: "rgba(46,230,160,0.13)",
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
  if (!evidence.url) return null;
  return (
    <a
      href={evidence.url}
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
        background: "rgba(113,50,245,0.06)",
        textDecoration: "none",
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--cc-border-glow)";
        (e.currentTarget as HTMLAnchorElement).style.background = "rgba(113,50,245,0.14)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--cc-border)";
        (e.currentTarget as HTMLAnchorElement).style.background = "rgba(113,50,245,0.06)";
      }}
    >
      <span aria-hidden style={{ opacity: 0.7 }}>&#8599;</span>
      <span
        style={{
          maxWidth: "42ch",
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

const VERDICT_COLORS: Record<string, string> = {
  fabricated: "var(--cc-danger)",
  misrepresented: "var(--cc-warn)",
  mismatch: "var(--cc-warn)",
  "partial-match": "var(--cc-warn)",
  stale: "var(--cc-text-muted)",
  superseded: "var(--cc-text-muted)",
  contradiction: "var(--cc-danger)",
  ok: "var(--cc-ok)",
  uncertain: "var(--cc-text-muted)",
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const color = VERDICT_COLORS[verdict] ?? "var(--cc-text-muted)";
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
 * EvidenceDiff — fullscreen dark modal.
 *
 * Reads `evidenceDiff` from the store.  When non-null, renders a side-by-side
 * diff of the claim text (left) and the source snippet (right), with
 * word-level highlighting of differences.  The source URL is clickable.
 *
 * Close: Escape key or click the backdrop / Close button.
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

  // Compute diff tokens when both sides are available
  const diff =
    claim && evidence
      ? diffTokens(tokenise(claim.text), tokenise(evidence.snippet))
      : null;

  const motionProps = shouldReduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.98, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.98, y: 8 },
      };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — click to close */}
          <motion.div
            key="evidence-diff-backdrop"
            aria-hidden="true"
            className="fixed inset-0 z-50"
            style={{ background: "rgba(16,17,20,0.40)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
            onClick={() => setEvidenceDiff(null)}
          />

          {/* Panel */}
          <motion.div
            key="evidence-diff-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Evidence comparison"
            className="fixed inset-4 z-50 flex flex-col focus:outline-none sm:inset-8"
            style={{
              background: "var(--cc-surface)",
              border: "1px solid var(--cc-border)",
              borderRadius: "16px",
              boxShadow: "var(--shadow-card-hover)",
            }}
            {...motionProps}
            transition={{ duration: shouldReduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEvidenceDiff(null);
            }}
            tabIndex={-1}
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
                      maxWidth: "56ch",
                    }}
                  >
                    {finding ? finding.summary : "Claim vs source"}
                  </span>
                  {finding && <VerdictBadge verdict={finding.verdict} />}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {evidence && <SourceChip evidence={evidence} />}
                <button
                  type="button"
                  onClick={() => setEvidenceDiff(null)}
                  aria-label="Close evidence comparison"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    color: "var(--cc-text-muted)",
                    border: "1px solid var(--cc-border)",
                    borderRadius: "6px",
                    padding: "5px 12px",
                    background: "transparent",
                    cursor: "pointer",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--cc-bg)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--cc-text)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--cc-text-muted)";
                  }}
                >
                  Esc / Close
                </button>
              </div>
            </header>

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
          </motion.div>
        </>
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
