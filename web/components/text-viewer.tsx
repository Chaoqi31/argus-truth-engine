"use client";

import { useEffect, useRef } from "react";
import type { Claim, Finding } from "@/lib/types";
import { verdictTone } from "@/lib/colors";
import { sortFindingsForReview } from "@/lib/findings";

const TONE_BG: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-destructive/20",
  warn: "bg-warning/20",
  ok: "bg-success/20",
  muted: "bg-muted",
};

const TONE_BG_ACTIVE: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-destructive/40 ring-2 ring-destructive/60 shadow-[0_0_0_4px_rgba(217,45,32,0.12)]",
  warn: "bg-warning/40 ring-2 ring-warning/60 shadow-[0_0_0_4px_rgba(209,135,0,0.12)]",
  ok: "bg-success/40 ring-2 ring-success/60 shadow-[0_0_0_4px_rgba(20,158,97,0.12)]",
  muted: "bg-border ring-2 ring-primary shadow-[0_0_0_4px_rgba(113,50,245,0.12)]",
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

interface ResolvedClaim {
  claim: Claim;
  start: number;
  end: number;
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
    <div className="h-full overflow-y-auto rounded-lg border border-border bg-background p-6 transition-[border-color,box-shadow] duration-300 ease-enter hover:border-primary/20 hover:shadow-[inset_0_1px_0_rgba(113,50,245,0.08)]">
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
              className={`cursor-pointer rounded px-0.5 decoration-primary/50 outline-offset-2 transition-[background-color,box-shadow,color] duration-200 ease-enter box-decoration-clone hover:bg-primary/15 hover:shadow-[0_0_0_2px_rgba(113,50,245,0.18)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${bg}`}
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
  const findingByClaimId = new Map<string, Finding>();
  for (const finding of sortFindingsForReview(findings)) {
    if (!findingByClaimId.has(finding.claim_id)) {
      findingByClaimId.set(finding.claim_id, finding);
    }
  }

  const sorted = claims
    .map((claim) => resolveClaimRange(text, claim))
    .filter((claim): claim is ResolvedClaim => claim !== null)
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const item of sorted) {
    const { claim, start, end } = item;
    if (start < cursor) continue;

    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), claimId: null, tone: "muted" });
    }

    const finding = findingByClaimId.get(claim.id);
    const tone = finding ? verdictTone[finding.verdict] : "muted";
    segments.push({ text: text.slice(start, end), claimId: claim.id, tone });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), claimId: null, tone: "muted" });
  }

  return segments;
}

function resolveClaimRange(text: string, claim: Claim): ResolvedClaim | null {
  const fromText = findClosestTextMatch(text, claim.text, claim.span[0]);
  if (fromText !== null) {
    return { claim, start: fromText, end: fromText + claim.text.length };
  }

  const [rawStart, rawEnd] = claim.span;
  if (rawStart >= rawEnd || rawStart < 0 || rawEnd > text.length) return null;
  const [start, end] = snapRangeToWordEdges(text, rawStart, rawEnd);
  if (start >= end) return null;
  return { claim, start, end };
}

function findClosestTextMatch(text: string, query: string, preferredStart: number): number | null {
  const needle = query.trim();
  if (!needle) return null;

  const exact = collectMatches(text, needle);
  if (exact.length > 0) return closestMatch(exact, preferredStart);

  const lowerMatches = collectMatches(text.toLocaleLowerCase(), needle.toLocaleLowerCase());
  if (lowerMatches.length > 0) return closestMatch(lowerMatches, preferredStart);

  return null;
}

function collectMatches(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let cursor = 0;
  while (cursor <= haystack.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) break;
    out.push(found);
    cursor = found + Math.max(needle.length, 1);
  }
  return out;
}

function closestMatch(matches: number[], preferredStart: number): number {
  return matches.reduce((best, next) =>
    Math.abs(next - preferredStart) < Math.abs(best - preferredStart) ? next : best,
  );
}

function snapRangeToWordEdges(text: string, rawStart: number, rawEnd: number): [number, number] {
  let start = rawStart;
  let end = rawEnd;

  while (start > 0 && isWordChar(text[start - 1]) && isWordChar(text[start])) {
    start -= 1;
  }
  while (end < text.length && isWordChar(text[end - 1]) && isWordChar(text[end])) {
    end += 1;
  }

  return [start, end];
}

function isWordChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9]/.test(char);
}
