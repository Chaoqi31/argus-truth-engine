"use client";

import type { Claim, Finding } from "@/lib/types";
import { verdictTone } from "@/lib/colors";

const TONE_BG: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-red-300/40 hover:bg-red-300/60",
  warn: "bg-yellow-300/40 hover:bg-yellow-300/60",
  ok: "bg-green-300/40 hover:bg-green-300/60",
  muted: "bg-gray-300/40 hover:bg-gray-300/60",
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
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onClaimClick(c.id)}
              className={`rounded-md border px-2 py-1 text-xs ${bg} ${
                isActive ? "border-primary" : "border-transparent"
              }`}
              title={c.text}
            >
              {finding ? finding.verdict : c.type}
            </button>
          );
        })}
      </div>
    </div>
  );
}
