"use client";

import type { Claim, Finding } from "@/lib/types";
import { verdictTone } from "@/lib/colors";

// Theme-aware tints derived from the same tokens as severity badges, so
// dark mode renders correctly.
const TONE_BG: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-destructive/20 hover:bg-destructive/30 text-destructive-foreground",
  warn: "bg-warning/20 hover:bg-warning/30 text-warning-foreground",
  ok: "bg-success/20 hover:bg-success/30 text-success-foreground",
  muted: "bg-muted hover:bg-border text-muted-foreground",
};

interface Props {
  claims: Claim[];
  findings: Finding[];
  activeClaimId: string | null;
  onClaimClick: (claimId: string) => void;
}

/**
 * Plan C v1 places one highlight pill per claim near the top of its page —
 * not at the exact text-layer rectangle (that needs character-to-rect mapping
 * from pdf.js, planned for Plan D). The interaction (click → select finding)
 * is the part the demo video shows.
 */
export function HighlightOverlay({
  claims,
  findings,
  activeClaimId,
  onClaimClick,
}: Props) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto absolute right-3 top-3 flex flex-col gap-1">
        {claims.map((c) => {
          const finding = findings.find((f) => f.claim_id === c.id);
          const tone = finding ? verdictTone[finding.verdict] : "muted";
          const bg = TONE_BG[tone];
          const isActive = c.id === activeClaimId;
          const label = finding ? finding.verdict : c.type;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onClaimClick(c.id)}
              aria-label={`Claim on page ${c.page}: ${c.text}. Click to inspect.`}
              className={`min-h-9 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${bg} ${
                isActive ? "border-primary" : "border-transparent"
              }`}
              title={c.text}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
