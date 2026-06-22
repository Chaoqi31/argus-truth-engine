"use client";

import type { Job } from "@/lib/types";
import CountUp from "@/components/react-bits/CountUp";
import BlurText from "@/components/react-bits/BlurText";
import { ReasoningWalkthroughCta } from "@/components/reasoning-walkthrough-cta";

export function VerdictHero({
  job,
  onStartReasoningWalkthrough,
}: {
  job: Job;
  onStartReasoningWalkthrough: (findingId: string) => void;
}) {
  const sev = { critical: 0, major: 0, minor: 0 };
  const issueFindings = job.findings.filter((f) => f.verdict !== "ok");
  for (const f of issueFindings) {
    if (f.severity === "critical") sev.critical++;
    else if (f.severity === "major") sev.major++;
    else if (f.severity === "minor") sev.minor++;
  }
  const issues = sev.critical + sev.major + sev.minor;
  const verdicts = new Set(job.findings.map((f) => f.verdict));
  const flags: string[] = [];
  if (verdicts.has("fabricated")) flags.push("fabricated citations");
  if (verdicts.has("mismatch") || verdicts.has("misrepresented")) {
    flags.push("misaligned quotes");
  }
  if (verdicts.has("inaccurate")) flags.push("incorrect facts");
  if (verdicts.has("outdated") || verdicts.has("stale") || verdicts.has("superseded")) flags.push("stale data");
  if (verdicts.has("contradiction")) flags.push("internal contradictions");
  if (verdicts.has("unsupported-inference") || verdicts.has("overreach")) {
    flags.push("unsupported reasoning");
  }

  const tone: "danger" | "warn" | "ok" =
    sev.critical > 0 ? "danger" : sev.major > 0 ? "warn" : "ok";
  const toneColor: Record<typeof tone, string> = {
    danger: "var(--cc-danger)",
    warn: "var(--cc-warn)",
    ok: "var(--cc-ok)",
  };

  const subject = job.input_mode === "text" ? "this content" : "this report";
  const total = job.claims_total && job.claims_total > 0 ? job.claims_total : job.claims.length;
  const audited = job.claims_audited && job.claims_audited > 0 ? job.claims_audited : job.findings.filter((f) => f.agent === "UnifiedVerifier").length;
  const partial = total > 0 && audited < total;
  const unchecked = Math.max(0, total - audited);
  const failed = job.status === "failed" || job.status === "interrupted";
  let headline: string;
  if (failed) {
    headline = `Argus stopped before completing ${subject}.`;
  } else if (partial) {
    headline = `Argus partially audited ${subject}.`;
  } else if (issues === 0) {
    headline = `Argus found no issues in ${subject}.`;
  } else if (flags.length > 0) {
    const joined =
      flags.length === 1
        ? flags[0]
        : flags.slice(0, -1).join(", ") + " and " + flags[flags.length - 1];
    headline = `Argus flagged ${subject} for ${joined}.`;
  } else {
    headline = "Argus found issues worth reviewing.";
  }

  const counts: Array<{ n: number; label: string; color: string }> = [];
  if (sev.critical) counts.push({ n: sev.critical, label: "critical", color: "var(--cc-danger)" });
  if (sev.major) counts.push({ n: sev.major, label: "major", color: "var(--cc-warn)" });
  if (sev.minor) counts.push({ n: sev.minor, label: "minor", color: "var(--cc-text-muted)" });

  return (
    <section
      role="status"
      className="relative flex min-h-20 items-center gap-4 overflow-hidden border-b border-[var(--cc-border)] px-6 py-3"
    >
      <span
        aria-hidden
        className="cc-status-dot relative size-3 shrink-0 rounded-full"
        style={{ color: toneColor[tone], backgroundColor: toneColor[tone] }}
      />
      <div className="relative min-w-0 flex-1">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Conclusion
        </p>
        <BlurText
          key={headline}
          text={headline}
          className="text-base font-bold tracking-tight text-[var(--cc-text)] md:text-lg"
          animateBy="words"
          delay={60}
        />
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {audited}/{total || job.claims.length} selected claims checked
          </span>
          <span aria-hidden>·</span>
          <span>{issues} issue{issues === 1 ? "" : "s"} found</span>
          <span aria-hidden>·</span>
          <span>{job.evidences.length} cited source{job.evidences.length === 1 ? "" : "s"}</span>
          {partial && (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium text-warning-foreground">
                {unchecked} unchecked
              </span>
            </>
          )}
        </div>
        {(partial || failed) && (
          <p className="mt-1.5 inline-flex rounded bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
            Partial coverage: review unchecked claims before relying on a clean conclusion.
          </p>
        )}
      </div>

      <div className="hidden shrink-0 items-center gap-5 sm:flex">
        {counts.length > 0 && (
          <>
          {counts.map((c) => (
            <div key={c.label} className="text-right">
              <CountUp
                to={c.n}
                duration={1.1}
                className="block font-mono text-xl font-bold tabular-nums"
              />
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ color: c.color }}
              >
                {c.label}
              </span>
            </div>
          ))}
          <div className="text-right">
            <span className="block font-mono text-xl font-bold tabular-nums text-muted-foreground">
              {audited}/{total || job.claims.length}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              checked
            </span>
          </div>
          </>
        )}
        <ReasoningWalkthroughCta job={job} onStart={onStartReasoningWalkthrough} />
      </div>
    </section>
  );
}
