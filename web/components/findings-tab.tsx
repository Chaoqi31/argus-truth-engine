import type { Job, Severity } from "@/lib/types";
import { FindingCard } from "@/components/finding-card";

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

interface Props {
  job: Job;
  activeFindingId: string | null;
  onSelect: (findingId: string) => void;
}

export function FindingsTab({ job, activeFindingId, onSelect }: Props) {
  const ranked = [...job.findings].sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return r !== 0 ? r : b.confidence - a.confidence;
  });

  if (ranked.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">No findings yet — drop a job JSON.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {ranked.map((f) => (
        <FindingCard
          key={f.id}
          finding={f}
          active={f.id === activeFindingId}
          onClick={() => onSelect(f.id)}
        />
      ))}
    </div>
  );
}
