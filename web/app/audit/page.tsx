"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useArgusStore } from "@/lib/store";
import { ArgusHeader } from "@/components/argus-header";
import { JobStatsBar } from "@/components/job-stats-bar";
import { ReasoningPanel } from "@/components/reasoning-panel";
import { TraceStreamView } from "@/components/trace-stream-view";

// pdf.js references browser-only globals (DOMMatrix, etc.) that fail under SSR.
// Force the PdfViewer to client-only.
const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-muted">
        <div className="animate-shimmer h-3 w-48 rounded-full" aria-hidden />
        <span className="sr-only">Loading PDF viewer</span>
      </div>
    ),
  },
);

type RightMode = "reasoning" | "stream";

export default function AuditPage() {
  const router = useRouter();
  const job = useArgusStore((s) => s.job);
  const activeFindingId = useArgusStore((s) => s.activeFindingId);
  const setActiveFinding = useArgusStore((s) => s.setActiveFinding);
  const [mode, setMode] = useState<RightMode>("reasoning");

  useEffect(() => {
    if (!job) {
      router.replace("/");
    }
  }, [job, router]);

  if (!job) return null;

  const onClaimClick = (claimId: string) => {
    const f = job.findings.find((f) => f.claim_id === claimId);
    if (f) setActiveFinding(f.id);
  };

  const fileUrl = "/sample-report.pdf";

  return (
    <>
      <ArgusHeader />
      <JobStatsBar job={job} />
      <main className="grid h-[calc(100vh-3.5rem-2.75rem)] grid-cols-[1fr_460px]">
        <PdfViewer
          fileUrl={fileUrl}
          claims={job.claims}
          findings={job.findings}
          activeFindingId={activeFindingId}
          onClaimClick={onClaimClick}
        />
        <aside className="flex flex-col border-l border-border">
          <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-3 py-2">
            <ModeToggle current={mode} onChange={setMode} />
          </div>
          <div className="flex-1 overflow-hidden">
            {mode === "reasoning" ? (
              <ReasoningPanel
                job={job}
                activeFindingId={activeFindingId}
                onSelectFinding={setActiveFinding}
              />
            ) : (
              <TraceStreamView job={job} />
            )}
          </div>
        </aside>
      </main>
    </>
  );
}

function ModeToggle({
  current,
  onChange,
}: {
  current: RightMode;
  onChange: (m: RightMode) => void;
}) {
  const opts: Array<{ key: RightMode; label: string }> = [
    { key: "reasoning", label: "Reasoning" },
    { key: "stream", label: "Live trace" },
  ];
  return (
    <div className="flex w-full gap-1 rounded-md bg-background p-0.5 ring-1 ring-border">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`flex-1 rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors ${
            current === o.key
              ? "bg-primary text-white"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
