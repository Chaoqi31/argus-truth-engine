"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArgusHeader } from "@/components/argus-header";
import { getSharedJob, JobNotFoundError } from "@/lib/api";
import type { Finding, Job } from "@/lib/types";

export default function SharedAuditPage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => decodeParam(params.token), [params.token]);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setLoading(true);
    });
    getSharedJob(token)
      .then((nextJob) => {
        if (!active) return;
        setJob(nextJob);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof JobNotFoundError
            ? "This share link is expired, revoked, or no longer exists."
            : err instanceof Error
              ? err.message
              : String(err),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <>
      <ArgusHeader
        rightSlot={
          <Link
            href="/audit"
            className="rounded-[10px] bg-primary px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            Start auditing
          </Link>
        }
      />
      <main className="min-h-[calc(100vh-3.5rem)] bg-muted/40">
        <div className="mx-auto max-w-5xl px-5 py-6 sm:px-6 lg:px-8">
          {loading ? (
            <section className="rounded-lg border border-border bg-background p-6 shadow-[var(--shadow-card)]">
              <div className="animate-shimmer h-3 w-48 rounded-full" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">Loading shared audit...</p>
            </section>
          ) : error ? (
            <section className="rounded-lg border border-border bg-background p-6 text-center shadow-[var(--shadow-card)]">
              <h1 className="text-xl font-semibold">Shared audit unavailable</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {error}
              </p>
              <Link
                href="/audit"
                className="mt-5 inline-flex rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Start a new audit
              </Link>
            </section>
          ) : job ? (
            <SharedAudit job={job} />
          ) : null}
        </div>
      </main>
    </>
  );
}

function SharedAudit({ job }: { job: Job }) {
  const findings = job.findings ?? [];
  const title = sharedTitle(job);

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-border bg-background p-5 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Shared read-only audit
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Completed {job.completed_at ? formatDate(job.completed_at) : formatDate(job.created_at)}
            </p>
          </div>
          <StatusPill status={job.status} />
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat label="Findings" value={findings.length} />
          <Stat label="Claims audited" value={job.claims_audited ?? 0} />
          <Stat label="Claims total" value={job.claims_total ?? 0} />
        </dl>
      </section>

      {findings.length > 0 && (
        <section className="rounded-lg border border-border bg-background shadow-[var(--shadow-card)]">
          <div className="border-b border-border p-4">
            <h2 className="text-base font-semibold">Findings</h2>
          </div>
          <ul className="divide-y divide-border">
            {findings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        </section>
      )}

      {job.audit_report_md && (
        <section className="rounded-lg border border-border bg-background p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-base font-semibold">Audit report</h2>
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-sm leading-relaxed text-foreground">
            {job.audit_report_md}
          </pre>
        </section>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={finding.verdict} />
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
          {finding.severity}
        </span>
        <span className="text-xs text-muted-foreground">
          {Math.round(finding.confidence * 100)}% confidence
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-foreground">{finding.summary}</p>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/45 p-3">
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const cls =
    normalized === "done" || normalized === "ok"
      ? "border-success/20 bg-success/10 text-success-foreground"
      : normalized === "failed" ||
          normalized === "interrupted" ||
          normalized === "fabricated" ||
          normalized === "contradiction"
        ? "border-destructive/20 bg-destructive/10 text-destructive-foreground"
        : "border-primary/15 bg-primary-soft text-primary";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${cls}`}>
      {status}
    </span>
  );
}

function sharedTitle(job: Job): string {
  if (job.input_mode === "text" && job.input_text) {
    const compact = job.input_text.trim().replace(/\s+/g, " ");
    return compact.slice(0, 96) + (compact.length > 96 ? "..." : "");
  }
  return job.pdf_path?.split("/").pop() || job.id;
}

function decodeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value || "";
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
