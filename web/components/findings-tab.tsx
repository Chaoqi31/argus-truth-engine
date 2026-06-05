import { useEffect, useRef } from "react";
import type { Evidence, Job } from "@/lib/types";
import { FindingCard } from "@/components/finding-card";
import { useArgusStore } from "@/lib/store";
import { sortFindingsForReview } from "@/lib/findings";

interface Props {
  job: Job;
  activeFindingId: string | null;
  onSelect: (findingId: string) => void;
  onOpenDrawer: (findingId: string) => void;
}

export function FindingsTab({ job, activeFindingId, onSelect, onOpenDrawer }: Props) {
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const reviews = useArgusStore((s) => s.findingReviews);
  const claimById = new Map(job.claims.map((c) => [c.id, c]));
  const evidenceById = new Map(job.evidences.map((e) => [e.id, e]));
  const ranked = sortFindingsForReview(job.findings);
  const total = job.claims_total ?? 0;
  const audited = job.claims_audited ?? 0;
  const partial = total > 0 && audited < total;

  useEffect(() => {
    activeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeFindingId]);

  if (ranked.length === 0) {
    return (
      <div className="space-y-2 p-6 text-sm">
        <p className="font-medium text-foreground">
          {partial ? "No completed verdicts yet." : "No issues found in the checked claims."}
        </p>
        <p className="text-muted-foreground">
          {partial
            ? `${audited}/${total} selected claims received a verdict. Review coverage before treating this audit as complete.`
            : "The audit produced no reviewable findings for the completed coverage set."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="px-1 text-[11px] text-muted-foreground">
        Highest-risk findings first.
      </p>
      {partial && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          Partial coverage: {audited}/{total} selected claims received a verdict.
        </div>
      )}
      {ranked.map((f) => {
        const active = f.id === activeFindingId;
        return (
          <div key={f.id} ref={active ? activeCardRef : null} data-finding-id={f.id}>
            <FindingCard
              finding={f}
              claim={claimById.get(f.claim_id)}
              evidences={f.evidence_ids
                .map((id) => evidenceById.get(id))
                .filter((e): e is Evidence => e !== undefined)}
              review={reviews[f.id] ?? null}
              active={active}
              onClick={() => onSelect(f.id)}
              onOpenDrawer={() => onOpenDrawer(f.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
