"use client";

import { useState } from "react";
import { getJudgeProofStrip, getTechnicalDepthProof } from "@/lib/technical-depth";
import type { Job } from "@/lib/types";

interface Props {
  job: Job;
}

export function TechnicalDepthPanel({ job }: Props) {
  const [open, setOpen] = useState(false);
  const proof = getTechnicalDepthProof(job);
  const judgeProofs = getJudgeProofStrip(job);
  if (proof.requiredCount === 0) return null;
  const missing = proof.requiredCount - proof.presentCount;
  const detailsId = "technical-depth-details";

  return (
    <section className="border-b border-border bg-background/80 px-6 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-baseline gap-2 rounded-[8px] border border-border bg-muted/50 px-2.5 py-1 text-left transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span
            className={`font-mono text-sm font-semibold tabular-nums ${
              missing > 0 ? "text-warning-foreground" : "text-emerald-700"
            }`}
          >
            {proof.presentCount}/{proof.requiredCount}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            technical proof
          </span>
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {proof.proofs.slice(0, 5).map((item) => (
            <span
              key={item.id}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                item.status === "present"
                  ? "bg-emerald-500/10 text-emerald-700"
                  : item.status === "not_applicable"
                    ? "bg-muted text-muted-foreground"
                    : "bg-warning/15 text-warning-foreground"
              }`}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <section
        aria-labelledby="judge-proof-strip-heading"
        className="mt-2"
      >
        <h2
          id="judge-proof-strip-heading"
          className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Judge proof strip
        </h2>
        <ul className="grid gap-1.5 md:grid-cols-5">
          {judgeProofs.map((item) => (
            <li
              key={item.id}
              className="min-w-0 rounded border border-border bg-background px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold text-foreground">
                  {item.label}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
                    item.status === "present"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : item.status === "not_applicable"
                        ? "bg-muted text-muted-foreground"
                        : "bg-warning/15 text-warning-foreground"
                  }`}
                >
                  {item.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                {item.detail}
              </p>
            </li>
          ))}
        </ul>
      </section>
      {open && (
        <div
          id={detailsId}
          role="region"
          aria-label="technical proof details"
          className="mt-2 grid gap-1.5 md:grid-cols-2 xl:grid-cols-4"
        >
          {proof.proofs.map((item) => (
            <div key={item.id} className="min-w-0 rounded border border-border bg-muted/30 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                    item.status === "present"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : item.status === "not_applicable"
                        ? "bg-muted text-muted-foreground"
                        : "bg-warning/15 text-warning-foreground"
                  }`}
                >
                  {item.status.replace("_", " ")}
                </span>
                <span className="truncate text-xs font-semibold">{item.label}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.evidence}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
