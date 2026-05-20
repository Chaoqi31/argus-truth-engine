"use client";

import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { Claim, Finding } from "@/lib/types";
import { HighlightOverlay } from "@/components/highlight-overlay";

// Load the worker from the pdfjs-dist package shipped with react-pdf.
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

interface Props {
  fileUrl: string;
  claims: Claim[];
  findings: Finding[];
  activeFindingId: string | null;
  onClaimClick: (claimId: string) => void;
}

export function PdfViewer({
  fileUrl,
  claims,
  findings,
  activeFindingId,
  onClaimClick,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(720);

  useEffect(() => {
    const update = () => setPageWidth(Math.min(720, window.innerWidth * 0.55));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const activeClaimId = activeFindingId
    ? findings.find((f) => f.id === activeFindingId)?.claim_id ?? null
    : null;

  return (
    <div className="overflow-y-auto bg-muted">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={<p className="p-6 text-sm text-muted-foreground">Loading PDF…</p>}
        error={<p className="p-6 text-sm text-destructive">Failed to load PDF.</p>}
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
          const pageClaims = claims.filter((c) => c.page === p);
          return (
            <div key={p} className="relative mx-auto my-4 w-fit shadow">
              <Page pageNumber={p} width={pageWidth} renderTextLayer renderAnnotationLayer={false} />
              <HighlightOverlay
                claims={pageClaims}
                findings={findings}
                activeClaimId={activeClaimId}
                onClaimClick={onClaimClick}
              />
            </div>
          );
        })}
      </Document>
    </div>
  );
}
