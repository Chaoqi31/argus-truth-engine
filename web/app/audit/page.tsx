"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useArgusStore } from "@/lib/store";
import { ArgusHeader } from "@/components/argus-header";
import { ReasoningPanel } from "@/components/reasoning-panel";
import { TraceStreamView } from "@/components/trace-stream-view";

// pdf.js references browser-only globals (DOMMatrix, etc.) that fail under SSR.
// Force the PdfViewer to client-only.
const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((m) => m.PdfViewer),
  { ssr: false, loading: () => <p className="p-6 text-sm text-muted-foreground">Loading PDF viewer…</p> },
);

export default function AuditPage() {
  const router = useRouter();
  const job = useArgusStore((s) => s.job);
  const activeFindingId = useArgusStore((s) => s.activeFindingId);
  const setActiveFinding = useArgusStore((s) => s.setActiveFinding);
  const [rightTab, setRightTab] = useState<"reasoning" | "stream">("reasoning");

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
      <ArgusHeader
        rightSlot={
          <div className="flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => setRightTab("reasoning")}
              className={`rounded px-2 py-1 ${rightTab === "reasoning" ? "bg-muted" : ""}`}
            >
              Reasoning
            </button>
            <button
              type="button"
              onClick={() => setRightTab("stream")}
              className={`rounded px-2 py-1 ${rightTab === "stream" ? "bg-muted" : ""}`}
            >
              Trace stream
            </button>
          </div>
        }
      />
      <main className="grid h-[calc(100vh-3.25rem)] grid-cols-[1fr_460px]">
        <PdfViewer
          fileUrl={fileUrl}
          claims={job.claims}
          findings={job.findings}
          activeFindingId={activeFindingId}
          onClaimClick={onClaimClick}
        />
        <aside className="border-l border-border">
          {rightTab === "reasoning" ? (
            <ReasoningPanel
              job={job}
              activeFindingId={activeFindingId}
              onSelectFinding={setActiveFinding}
            />
          ) : (
            <TraceStreamView job={job} />
          )}
        </aside>
      </main>
    </>
  );
}
