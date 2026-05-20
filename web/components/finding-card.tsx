import type { Finding } from "@/lib/types";
import { SeverityBadge } from "@/components/severity-badge";

interface Props {
  finding: Finding;
  active: boolean;
  onClick: () => void;
}

export function FindingCard({ finding, active, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted ${
        active ? "border-primary bg-muted" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-mono text-muted-foreground">{finding.agent}</span>
        <SeverityBadge severity={finding.severity} />
      </div>
      <p className="mt-1 text-sm">{finding.summary}</p>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>verdict: {finding.verdict}</span>
        <span>confidence: {(finding.confidence * 100).toFixed(0)}%</span>
      </div>
    </button>
  );
}
