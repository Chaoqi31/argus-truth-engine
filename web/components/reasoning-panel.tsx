"use client";

import { useState } from "react";
import type { Job } from "@/lib/types";
import { FindingsTab } from "@/components/findings-tab";
import { EvidenceTab } from "@/components/evidence-tab";
import { DagTab } from "@/components/dag-tab";

type Tab = "findings" | "evidence" | "dag";

const TABS: ReadonlyArray<{ key: Tab; label: string; icon: string }> = [
  { key: "findings", label: "Findings", icon: "🛡" },
  { key: "evidence", label: "Evidence", icon: "🔗" },
  { key: "dag", label: "DAG", icon: "🧠" },
];

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
      <div className="flex gap-1 border-b border-border bg-muted/30 p-1.5">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              aria-label={`Show ${t.label} tab`}
              className={`inline-flex min-h-9 flex-1 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span aria-hidden className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          );
        })}
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
