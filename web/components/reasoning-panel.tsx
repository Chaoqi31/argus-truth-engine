"use client";

import { useState } from "react";
import type { Job } from "@/lib/types";
import { FindingsTab } from "@/components/findings-tab";
import { EvidenceTab } from "@/components/evidence-tab";
import { DagTab } from "@/components/dag-tab";

type Tab = "findings" | "evidence" | "dag";

interface Props {
  job: Job;
  activeFindingId: string | null;
  onSelectFinding: (id: string) => void;
}

export function ReasoningPanel({ job, activeFindingId, onSelectFinding }: Props) {
  const [tab, setTab] = useState<Tab>("findings");
  const activeFinding = job.findings.find((f) => f.id === activeFindingId) ?? null;
  const trace =
    activeFinding && job.traces.find((t) => t.id === activeFinding.reasoning_trace_id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-border">
        {(["findings", "evidence", "dag"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === "findings" && (
          <FindingsTab job={job} activeFindingId={activeFindingId} onSelect={onSelectFinding} />
        )}
        {tab === "evidence" && <EvidenceTab job={job} findingId={activeFindingId} />}
        {tab === "dag" && <DagTab trace={trace ?? null} />}
      </div>
    </div>
  );
}
