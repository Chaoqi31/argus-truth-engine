"use client";

import { useArgusStore } from "@/lib/store";
import { submitClaimSelection } from "@/lib/api";
import type { ReviewClaim } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  citation: "Citation",
  "numerical-data": "Data",
  "time-sensitive": "Time-sensitive",
  "cross-reference": "Cross-ref",
  qualitative: "Qualitative",
};

const IMPORTANCE_COLOR: Record<string, string> = {
  high: "text-[var(--cc-danger,#d92d20)]",
  medium: "text-[var(--cc-warn,#d18700)]",
  low: "text-muted-foreground",
};

interface Props {
  jobId: string;
}

export function ClaimReviewPanel({ jobId }: Props) {
  const reviewClaims = useArgusStore((s) => s.reviewClaims);
  const filteredClaims = useArgusStore((s) => s.filteredClaims);
  const selectedClaimIds = useArgusStore((s) => s.selectedClaimIds);
  const toggleClaimSelection = useArgusStore((s) => s.toggleClaimSelection);
  const selectAllClaims = useArgusStore((s) => s.selectAllClaims);
  const selectHighImportanceClaims = useArgusStore((s) => s.selectHighImportanceClaims);
  const setRunStatus = useArgusStore((s) => s.setRunStatus);

  const nSelected = selectedClaimIds.size;
  const highCount = reviewClaims.filter((c) => c.importance === "high").length;

  const grouped = reviewClaims.reduce<Record<string, ReviewClaim[]>>((acc, c) => {
    const key = c.type || "qualitative";
    (acc[key] ??= []).push(c);
    return acc;
  }, {});

  async function handleSubmit() {
    const ids = Array.from(selectedClaimIds);
    // BYOK: re-send the key on resume — the backend never persists it.
    const apiKey =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("argus-miromind-key") ??
          window.localStorage.getItem("argus-miromind-key")
        : null;
    try {
      await submitClaimSelection(jobId, ids, apiKey);
      setRunStatus("verifying");
    } catch {
      /* backend will timeout and proceed anyway */
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Review Claims</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Select which claims to verify with MiroMind. Uncheck claims you
          don&apos;t need verified to save credits.
        </p>
      </div>

      {/* Claim list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(grouped).map(([type, claims]) => (
          <section key={type}>
            <h3 className="mb-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              {TYPE_LABELS[type] ?? type} ({claims.length})
            </h3>
            <ul className="space-y-1.5">
              {claims.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/50">
                    <input
                      type="checkbox"
                      aria-label={c.text}
                      checked={selectedClaimIds.has(c.id)}
                      onChange={() => toggleClaimSelection(c.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug">{c.text}</span>
                      <span
                        className={`text-[10px] font-mono ${IMPORTANCE_COLOR[c.importance] ?? ""}`}
                      >
                        {c.importance}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Filtered-out claims */}
        {filteredClaims.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {filteredClaims.length} claims filtered out (not checkworthy)
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {filteredClaims.map((f) => (
                <li key={f.claim_id} className="flex gap-2">
                  <span className="shrink-0 italic">{f.reason}</span>
                  <span className="line-clamp-1">{f.text}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectAllClaims}
            className="text-xs text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          >
            Select all
          </button>
          {highCount > 0 && (
            <button
              type="button"
              onClick={selectHighImportanceClaims}
              className="rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              High only
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={nSelected === 0}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          Verify {nSelected} claim{nSelected !== 1 ? "s" : ""} &rarr;
        </button>
      </div>
    </div>
  );
}
