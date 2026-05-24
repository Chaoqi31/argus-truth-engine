"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { Claim, Finding } from "@/lib/types";
import { HighlightOverlay } from "@/components/highlight-overlay";

// Load the pdfjs worker from a CDN matched to the installed pdfjs-dist version.
// (Turbopack cannot resolve the worker via `new URL("pdfjs-dist/...", import.meta.url)`
// because pdfjs-dist arrives as a hoisted peer of react-pdf, not a direct dep.)
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const update = () => setPageWidth(Math.min(720, window.innerWidth * 0.55));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const activeClaim = activeFindingId
    ? (() => {
        const f = findings.find((f) => f.id === activeFindingId);
        if (!f) return null;
        return claims.find((c) => c.id === f.claim_id) ?? null;
      })()
    : null;
  const activeClaimId = activeClaim?.id ?? null;
  const activePage = activeClaim?.page ?? null;

  // PM-fix #4: when a finding is selected (from the cards on the right or the
  // PDF itself), bring the cited page into view so the highlight is visible
  // without manual scrolling. Without this the left pane felt disconnected
  // from the right pane.
  useEffect(() => {
    if (activePage == null) return;
    const el = pageRefs.current.get(activePage);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activePage]);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto bg-muted">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={<p className="p-6 text-sm text-muted-foreground">Loading PDF…</p>}
        error={<p className="p-6 text-sm text-destructive">Failed to load PDF.</p>}
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
          const pageClaims = claims.filter((c) => c.page === p);
          return (
            <div
              key={p}
              ref={(el) => {
                if (el) pageRefs.current.set(p, el);
                else pageRefs.current.delete(p);
              }}
              className="relative mx-auto my-4 w-fit shadow"
            >
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
