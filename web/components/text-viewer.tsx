"use client";

import { useEffect, useRef } from "react";
import type { Claim, Finding } from "@/lib/types";
import { verdictTone } from "@/lib/colors";

const TONE_BG: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-destructive/20",
  warn: "bg-warning/20",
  ok: "bg-success/20",
  muted: "bg-muted",
};

const TONE_BG_ACTIVE: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-destructive/40 ring-2 ring-destructive/60",
  warn: "bg-warning/40 ring-2 ring-warning/60",
  ok: "bg-success/40 ring-2 ring-success/60",
  muted: "bg-border ring-2 ring-primary",
};

interface Props {
  text: string;
  claims: Claim[];
  findings: Finding[];
  activeFindingId: string | null;
  onClaimClick: (claimId: string) => void;
}

interface Segment {
  text: string;
  claimId: string | null;
  tone: "danger" | "warn" | "ok" | "muted";
}

export function TextViewer({
  text,
  claims,
  findings,
  activeFindingId,
  onClaimClick,
}: Props) {
  const activeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeFindingId]);

  const activeFinding = findings.find((f) => f.id === activeFindingId);
  const activeClaimId = activeFinding?.claim_id ?? null;

  const segments = buildSegments(text, claims, findings);

  return (
    <div className="h-full overflow-y-auto rounded-lg border border-border bg-background p-6">
      <div className="mx-auto max-w-[720px] whitespace-pre-wrap text-sm leading-7 text-foreground">
        {segments.map((seg, i) => {
          if (!seg.claimId) {
            return <span key={i}>{seg.text}</span>;
          }
          const isActive = seg.claimId === activeClaimId;
          const bg = isActive ? TONE_BG_ACTIVE[seg.tone] : TONE_BG[seg.tone];
          return (
            <span
              key={i}
              ref={isActive ? activeRef : undefined}
              role="button"
              tabIndex={0}
              onClick={() => onClaimClick(seg.claimId!)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onClaimClick(seg.claimId!);
              }}
              className={`cursor-pointer rounded px-0.5 transition-colors ${bg}`}
            >
              {seg.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function buildSegments(
  text: string,
  claims: Claim[],
  findings: Finding[],
): Segment[] {
  const sorted = [...claims]
    .filter((c) => c.span[0] < c.span[1] && c.span[1] <= text.length)
    .sort((a, b) => a.span[0] - b.span[0]);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const claim of sorted) {
    const [start, end] = claim.span;
    if (start < cursor) continue;

    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), claimId: null, tone: "muted" });
    }

    const finding = findings.find((f) => f.claim_id === claim.id);
    const tone = finding ? verdictTone[finding.verdict] : "muted";
    segments.push({ text: text.slice(start, end), claimId: claim.id, tone });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), claimId: null, tone: "muted" });
  }

  return segments;
}
