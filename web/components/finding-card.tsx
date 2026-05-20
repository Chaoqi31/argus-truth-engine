import type { Finding } from "@/lib/types";
import { SeverityBadge } from "@/components/severity-badge";
import { verdictTone } from "@/lib/colors";

interface Props {
  finding: Finding;
  active: boolean;
  onClick: () => void;
}

const TONE_BAR: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "bg-destructive",
  warn: "bg-warning",
  ok: "bg-success",
  muted: "bg-border-strong",
};

export function FindingCard({ finding, active, onClick }: Props) {
  const tone = verdictTone[finding.verdict];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-[var(--radius-card)] border bg-background p-3 pl-4 text-left shadow-[var(--shadow-card)] transition-all hover:-translate-y-px hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
        active ? "border-primary" : "border-border"
      }`}
    >
      {/* Vertical accent bar coloured by verdict tone */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${TONE_BAR[tone]}`} />

      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {finding.agent}
        </span>
        <SeverityBadge severity={finding.severity} />
      </div>
      <p className="mt-1 text-sm leading-snug">{finding.summary}</p>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="font-mono font-semibold text-foreground">{finding.verdict}</span>
        <span aria-hidden>·</span>
        <span>
          confidence{" "}
          <span className="font-mono tabular-nums text-foreground">{(finding.confidence * 100).toFixed(0)}%</span>
        </span>
        {finding.evidence_ids.length > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{finding.evidence_ids.length} evidence</span>
          </>
        )}
      </div>
    </button>
  );
}
