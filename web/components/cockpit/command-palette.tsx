"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useArgusStore } from "@/lib/store";
import type { Finding, Claim } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResultKind = "finding" | "claim" | "action";

interface FindingResult {
  kind: "finding";
  id: string;
  label: string;
  meta: string;
  verdict: string;
  severity: string;
}

interface ClaimResult {
  kind: "claim";
  id: string;
  label: string;
  meta: string;
}

interface ActionResult {
  kind: "action";
  id: string;
  label: string;
  meta: string;
}

type Result = FindingResult | ClaimResult | ActionResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Very lightweight fuzzy match: every char in `needle` appears in order in `haystack`. */
function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const pos = h.indexOf(n[ni], hi);
    if (pos === -1) return false;
    hi = pos + 1;
  }
  return true;
}

const VERDICT_LABELS: Record<string, string> = {
  ok: "OK",
  fabricated: "Fabricated",
  "partial-match": "Partial match",
  mismatch: "Mismatch",
  misrepresented: "Misrepresented",
  stale: "Stale",
  superseded: "Superseded",
  contradiction: "Contradiction",
  uncertain: "Uncertain",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

function verdictClass(verdict: string): string {
  if (verdict === "ok") return "verdict-ok";
  if (verdict === "fabricated" || verdict === "mismatch" || verdict === "misrepresented")
    return "verdict-danger";
  if (verdict === "stale" || verdict === "superseded" || verdict === "partial-match")
    return "verdict-warn";
  return "verdict-muted";
}

// ---------------------------------------------------------------------------
// Static action registry
// ---------------------------------------------------------------------------

const STATIC_ACTIONS: ActionResult[] = [
  {
    kind: "action",
    id: "action:export",
    label: "Export findings as JSON",
    meta: "Action",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Command palette — T4 implementation.
 *
 * Contract (per stub):
 *   - reads `paletteOpen` (boolean).
 *   - close by calling `setPaletteOpen(false)`.
 *   - finding → `setActiveFinding(id)` + `setDrawerFinding(id)`.
 *   - ⌘K open listener lives in the audit page.
 */
export function CommandPalette() {
  const paletteOpen = useArgusStore((s) => s.paletteOpen);
  const setPaletteOpen = useArgusStore((s) => s.setPaletteOpen);
  const setActiveFinding = useArgusStore((s) => s.setActiveFinding);
  const setDrawerFinding = useArgusStore((s) => s.setDrawerFinding);
  const job = useArgusStore((s) => s.job);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  // Reset query + selection each time the palette opens. Adjusting state
  // during render on a tracked value change (instead of in an effect) avoids
  // a wasted commit + the set-state-in-effect cascade.
  const [wasOpen, setWasOpen] = useState(paletteOpen);
  if (paletteOpen !== wasOpen) {
    setWasOpen(paletteOpen);
    if (paletteOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  // Esc closes (the ⌘K open toggle lives in the page-level listener).
  useEffect(() => {
    if (!paletteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  // Build filtered results
  const results: Result[] = (() => {
    const out: Result[] = [];
    const q = query.trim();

    if (job) {
      // Findings
      for (const f of job.findings as Finding[]) {
        const searchable = [
          f.summary,
          VERDICT_LABELS[f.verdict] ?? f.verdict,
          SEVERITY_LABELS[f.severity] ?? f.severity,
        ].join(" ");
        if (fuzzyMatch(searchable, q)) {
          out.push({
            kind: "finding",
            id: f.id,
            label: f.summary,
            meta: `${VERDICT_LABELS[f.verdict] ?? f.verdict} · ${SEVERITY_LABELS[f.severity] ?? f.severity}`,
            verdict: f.verdict,
            severity: f.severity,
          });
        }
      }
      // Claims
      for (const c of job.claims as Claim[]) {
        if (fuzzyMatch(c.text, q)) {
          out.push({
            kind: "claim",
            id: c.id,
            label: c.text,
            meta: `Claim · ${c.type}`,
          });
        }
      }
    }

    // Static actions — always shown when query matches
    for (const a of STATIC_ACTIONS) {
      if (fuzzyMatch(a.label, q)) {
        out.push(a);
      }
    }

    return out;
  })();

  // Keep the selection in range when the result set shrinks. Derived during
  // render so there's no effect-driven re-render; the raw `activeIndex` state
  // is still the source of truth for keyboard navigation.
  const safeActiveIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  const execute = useCallback(
    (r: Result) => {
      switch (r.kind) {
        case "finding": {
          setActiveFinding(r.id);
          setDrawerFinding(r.id);
          setPaletteOpen(false);
          break;
        }
        case "claim": {
          // Find the related finding for this claim and open it
          const finding = job?.findings.find((f) => f.claim_id === r.id);
          if (finding) {
            setActiveFinding(finding.id);
            setDrawerFinding(finding.id);
          }
          setPaletteOpen(false);
          break;
        }
        case "action": {
          if (r.id === "action:export") {
            if (job) {
              const blob = new Blob([JSON.stringify(job.findings, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `argus-findings-${job.id}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }
            setPaletteOpen(false);
          }
          break;
        }
      }
    },
    [job, setActiveFinding, setDrawerFinding, setPaletteOpen]
  );

  // Keyboard navigation inside the palette
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[safeActiveIndex];
      if (r) execute(r);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[data-active='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, [safeActiveIndex]);

  // Motion config: skip scale/translate when reduced-motion is preferred
  const dialogVariants = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { y: -12, scale: 0.98, opacity: 0 },
        animate: { y: 0, scale: 1, opacity: 1 },
        exit: { y: -12, scale: 0.98, opacity: 0 },
      };

  const scrimVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  };

  // Group label render
  function groupLabel(kind: ResultKind) {
    if (kind === "finding") return "Findings";
    if (kind === "claim") return "Claims";
    return "Actions";
  }

  // Render group headers between kind transitions
  const withHeaders: Array<{ isHeader: true; label: string } | { isHeader: false; result: Result; idx: number }> =
    [];
  let lastKind: ResultKind | null = null;
  let flatIdx = 0;
  for (const r of results) {
    if (r.kind !== lastKind) {
      withHeaders.push({ isHeader: true, label: groupLabel(r.kind) });
      lastKind = r.kind;
    }
    withHeaders.push({ isHeader: false, result: r, idx: flatIdx });
    flatIdx++;
  }

  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div
          key="palette-root"
          className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
          variants={scrimVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close command palette"
            onClick={() => setPaletteOpen(false)}
            className="absolute inset-0 bg-[#101114]/40"
            tabIndex={-1}
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="cc-glass relative w-full max-w-[560px] overflow-hidden rounded-2xl border border-[var(--cc-border)] shadow-[var(--cc-glow)]"
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={
              prefersReducedMotion
                ? { duration: 0.15 }
                : { type: "spring", stiffness: 360, damping: 30 }
            }
          >
            {/* Search input */}
            <div className="flex items-center gap-2 border-b border-[var(--cc-border)] px-4 py-3">
              <span aria-hidden className="shrink-0 text-[var(--cc-text-muted)]">
                ⌕
              </span>
              <input
                ref={inputRef}
                autoFocus
                type="text"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-autocomplete="list"
                aria-controls="palette-results"
                placeholder="Jump to a finding, filter by verdict, run an action…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onInputKeyDown}
                className="w-full bg-transparent text-sm text-[var(--cc-text)] placeholder:text-[var(--cc-text-muted)] focus:outline-none"
              />
              <kbd className="shrink-0 rounded border border-[var(--cc-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--cc-text-muted)]">
                esc
              </kbd>
            </div>

            {/* Results */}
            <div
              id="palette-results"
              role="listbox"
              ref={listRef}
              className="max-h-[50vh] overflow-y-auto px-2 py-2"
            >
              {withHeaders.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-[var(--cc-text-muted)]">
                  {query ? "No results for that query." : "No findings loaded."}
                </p>
              ) : (
                withHeaders.map((item, i) => {
                  if (item.isHeader) {
                    return (
                      <p
                        key={`header-${item.label}-${i}`}
                        className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--cc-text-muted)]"
                      >
                        {item.label}
                      </p>
                    );
                  }

                  const { result: r, idx } = item;
                  const isActive = idx === safeActiveIndex;

                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      onClick={() => execute(r)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={[
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                        isActive
                          ? "bg-[var(--cc-bg)] text-[var(--cc-text)]"
                          : "text-[var(--cc-text-muted)] hover:bg-[var(--cc-bg)] hover:text-[var(--cc-text)]",
                      ].join(" ")}
                    >
                      {/* Kind icon */}
                      <span
                        aria-hidden
                        className="shrink-0 text-xs text-[var(--cc-text-muted)]"
                      >
                        {r.kind === "finding" ? "◈" : r.kind === "claim" ? "◻" : "⌘"}
                      </span>

                      {/* Label + meta */}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm leading-snug">
                          {r.label}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--cc-text-muted)]">
                          {r.kind === "finding" ? (
                            <>
                              <span
                                className={[
                                  "inline-block rounded px-1 py-px text-[10px] font-semibold",
                                  verdictClass(r.verdict),
                                ].join(" ")}
                              >
                                {VERDICT_LABELS[r.verdict] ?? r.verdict}
                              </span>
                              {" · "}
                              {SEVERITY_LABELS[r.severity] ?? r.severity}
                            </>
                          ) : (
                            r.meta
                          )}
                        </span>
                      </span>

                      {/* Enter hint when active */}
                      {isActive && (
                        <kbd
                          aria-hidden
                          className="shrink-0 rounded border border-[var(--cc-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--cc-text-muted)]"
                        >
                          enter
                        </kbd>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-4 border-t border-[var(--cc-border)] px-4 py-2">
              <span className="text-[10px] text-[var(--cc-text-muted)]">
                <kbd className="rounded border border-[var(--cc-border)] px-1 py-px font-mono text-[9px]">↑</kbd>
                <kbd className="ml-0.5 rounded border border-[var(--cc-border)] px-1 py-px font-mono text-[9px]">↓</kbd>
                {" "}navigate
              </span>
              <span className="text-[10px] text-[var(--cc-text-muted)]">
                <kbd className="rounded border border-[var(--cc-border)] px-1 py-px font-mono text-[9px]">enter</kbd>
                {" "}select
              </span>
              <span className="text-[10px] text-[var(--cc-text-muted)]">
                <kbd className="rounded border border-[var(--cc-border)] px-1 py-px font-mono text-[9px]">esc</kbd>
                {" "}close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
