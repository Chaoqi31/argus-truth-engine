"use client";

import { useEffect, useState } from "react";
import type { Job } from "@/lib/types";
import { FindingsTab } from "@/components/findings-tab";
import { EvidenceTab } from "@/components/evidence-tab";

type Tab = "findings" | "evidence";

const TABS: ReadonlyArray<{ key: Tab; label: string; icon: string }> = [
  { key: "findings", label: "Findings", icon: "🛡" },
  { key: "evidence", label: "Evidence", icon: "🔗" },
];

interface Props {
  job: Job;
  activeFindingId: string | null;
  onSelectFinding: (id: string) => void;
}

export function ReasoningPanel({ job, activeFindingId, onSelectFinding }: Props) {
  const [tab, setTab] = useState<Tab>("findings");

  // PM-fix #4: when the user clicks a finding (or one is selected via the
  // PDF), jump to the Evidence tab so the receipts are immediately visible.
  // Without this, the click only thickens a blue border and nothing else
  // visibly changes — users assume the click did nothing.
  useEffect(() => {
    if (activeFindingId) setTab("evidence");
  }, [activeFindingId]);

  const handleSelect = (id: string) => {
    onSelectFinding(id);
    setTab("evidence");
  };

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
          <FindingsTab job={job} activeFindingId={activeFindingId} onSelect={handleSelect} />
        )}
        {tab === "evidence" && <EvidenceTab job={job} findingId={activeFindingId} />}
      </div>
    </div>
  );
}
