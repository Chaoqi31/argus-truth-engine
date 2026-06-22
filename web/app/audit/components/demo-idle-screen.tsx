"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import type { Scenario } from "@/lib/load-job";
import type { Job } from "@/lib/types";
import { useArgusStore } from "@/lib/store";
import { ArgusHeader } from "@/components/argus-header";
import { ScenarioBanner } from "@/components/scenario-banner";
import { TextViewer } from "@/components/text-viewer";
import { AuthButton } from "@/components/auth-button";
import { DEMO_START_LINK } from "../lib/constants";

const DEMO_SCENARIOS: Array<{ key: Scenario; label: string }> = [
  { key: "legal", label: "Legal filing" },
  { key: "nvidia", label: "Investment research" },
];

const DEMO_COPY: Record<
  Scenario,
  { eyebrow: string; title: string; body: string; checklist: string[] }
> = {
  nvidia: {
    eyebrow: "Investment committee walkthrough",
    title: "Review an AI investment memo before committee",
    body:
      "Replay how Argus audits a vendor-style NVIDIA research note with planted factual errors, then turns the result into a claim-level review package.",
    checklist: [
      "Claims extracted from the memo",
      "Searches + sources streamed live",
      "Decisions saved to the Audit Pack",
    ],
  },
  legal: {
    eyebrow: "Legal review walkthrough",
    title: "Review an AI legal memo before filing",
    body:
      "Replay how Argus checks authority, citation fit, and source mismatch before a team relies on generated legal analysis.",
    checklist: [
      "Citations isolated by claim",
      "Source trail beside each verdict",
      "Reviewer notes kept for handoff",
    ],
  },
};

function RunIcon() {
  return (
    <svg width="13" height="14" viewBox="0 0 11 12" fill="currentColor" aria-hidden className="shrink-0">
      <path d="M1 1.2v9.6a.6.6 0 0 0 .92.5l7.7-4.8a.6.6 0 0 0 0-1l-7.7-4.8A.6.6 0 0 0 1 1.2Z" />
    </svg>
  );
}

export function DemoIdleScreen({
  job,
  onRun,
  onSkipToResults,
  scenario,
  onScenarioChange,
  signedInNotice,
}: {
  job: Job;
  onRun: () => void;
  onSkipToResults: () => void;
  scenario: Scenario;
  onScenarioChange: (s: Scenario) => void;
  signedInNotice?: ReactNode;
}) {
  const [starting, setStarting] = useState(false);
  const clearStore = useArgusStore((s) => s.clear);
  const copy = DEMO_COPY[scenario];
  return (
    <div className="cockpit cc-backdrop min-h-screen">
      <ArgusHeader
        rightSlot={
          <div className="flex items-center gap-2">
            <Link href="/audit" onClick={clearStore} className={DEMO_START_LINK}>
              Start auditing
            </Link>
            <AuthButton next="/audit?demo=1" />
          </div>
        }
      />
      {signedInNotice}
      {job.scenario_label && job.persona && (
        <ScenarioBanner label={job.scenario_label} persona={job.persona} />
      )}
      <main className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="hidden min-h-0 overflow-hidden p-4 lg:block">
          <TextViewer
            text={job.input_text ?? ""}
            claims={[]}
            findings={[]}
            activeFindingId={null}
            onClaimClick={() => {}}
          />
        </div>

        <aside className="flex flex-col justify-center gap-6 border-t border-[var(--cc-border)] px-8 py-12 lg:border-l lg:border-t-0">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
              Choose a scenario
            </span>
            <div className="flex gap-1 rounded-[10px] bg-muted p-0.5 ring-1 ring-[var(--cc-border)]">
              {DEMO_SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onScenarioChange(s.key)}
                  aria-pressed={scenario === s.key}
                  className={`flex-1 rounded-[8px] px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                    scenario === s.key
                      ? "bg-background text-foreground shadow-[var(--shadow-card)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
              {copy.eyebrow}
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--cc-text)]">
              {copy.title}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {copy.body}
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--cc-text)]">
              {copy.checklist.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span aria-hidden className="mt-2 size-1.5 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:hidden">
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-border bg-background p-4 text-xs leading-6 text-foreground">
              {job.input_text ?? ""}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setStarting(true);
                onRun();
              }}
              disabled={starting}
              aria-busy={starting}
              className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-primary px-6 py-3 text-sm font-semibold text-white shadow-[var(--cc-glow)] transition-colors hover:bg-[#5741d8] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              {starting ? (
                "Starting…"
              ) : (
                <>
                  <RunIcon />
                  Run audit walkthrough
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onSkipToResults}
              disabled={starting}
              className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              Skip to final results
            </button>
            <p className="text-[11px] text-[var(--cc-text-muted)]">
              No API key needed. Watch the live reasoning replay, or skip straight to the finished audit.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
