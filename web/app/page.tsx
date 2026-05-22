"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useArgusStore } from "@/lib/store";
import { loadSampleJob } from "@/lib/load-job";
import { uploadPdf, UnsupportedMediaTypeError, ArgusApiError } from "@/lib/api";
import { ArgusHeader } from "@/components/argus-header";
import { ApiKeyInput } from "@/components/api-key-input";

const POINTS = [
  { icon: "📚", title: "Fabricated citations", body: "Crossref / arXiv / SSRN cross-checks reveal references that don't exist." },
  { icon: "🪞", title: "Misaligned quotes", body: "We fetch the cited source and compare paragraphs side-by-side." },
  { icon: "📈", title: "Stale numbers", body: "FRED / World Bank / SEC EDGAR confirm whether a data point is still current." },
  { icon: "🧩", title: "Internal contradictions", body: "We catch report pages that contradict each other." },
];

type LoadingKind = "upload" | "sample" | null;

export default function HomePage() {
  const router = useRouter();
  const setJob = useArgusStore((s) => s.setJob);
  const resetLive = useArgusStore((s) => s.resetLive);
  const [loading, setLoading] = useState<LoadingKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  const trySample = async () => {
    setLoading("sample");
    setError(null);
    try {
      const job = await loadSampleJob();
      resetLive();
      setJob(job);
      router.push("/audit?demo=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  };

  const onPicked = async (file: File) => {
    if (!apiKey.trim()) {
      setError("Please paste your MiroMind API key above first.");
      return;
    }
    setLoading("upload");
    setError(null);
    try {
      const { job_id } = await uploadPdf(file, apiKey);
      resetLive();
      router.push(`/audit?id=${encodeURIComponent(job_id)}`);
    } catch (e) {
      if (e instanceof UnsupportedMediaTypeError) {
        setError("Only PDF files are supported.");
      } else if (e instanceof ArgusApiError) {
        setError(`API error: ${e.message}`);
      } else if (e instanceof Error) {
        setError(`Could not reach the Argus API. Is \`argus serve\` running? (${e.message})`);
      } else {
        setError(String(e));
      }
      setLoading(null);
    }
  };

  return (
    <>
      <ArgusHeader />
      <main className="relative mx-auto flex max-w-4xl flex-col items-center gap-12 px-6 py-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(ellipse_50%_60%_at_50%_0%,var(--color-primary-soft),transparent_70%)]" />

        <div className="flex flex-col items-center gap-5 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Built for the UCWS × MiroMind Deep Research track
          </span>
          <h1 className="text-balance text-5xl font-semibold tracking-tight md:text-6xl">
            Audit a research report.
            <br />
            <span className="text-primary">See every reasoning step.</span>
          </h1>
          <p className="max-w-2xl text-balance text-base text-muted-foreground md:text-lg">
            Argus surfaces fabricated citations, misaligned quotes, stale data, and internal
            contradictions in PDF research reports — and shows the full reasoning chain MiroMind
            used to reach each verdict.
          </p>
          <div className="mt-2 flex flex-col items-center gap-3">
            <ApiKeyInput value={apiKey} onChange={setApiKey} />
            <label
              className={
                "cursor-pointer rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md" +
                (loading !== null ? " pointer-events-none opacity-50" : "")
              }
            >
              {loading === "upload" ? "Uploading…" : "Upload a PDF →"}
              <input
                type="file"
                accept="application/pdf"
                disabled={loading !== null}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPicked(f);
                }}
              />
            </label>
            <button
              type="button"
              onClick={trySample}
              disabled={loading !== null}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              {loading === "sample" ? "Loading…" : "…or try the sample audit"}
            </button>
            {error && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground"
              >
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="grid w-full gap-3 md:grid-cols-2">
          {POINTS.map((p) => (
            <div
              key={p.title}
              className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
            >
              <span aria-hidden className="text-2xl leading-none">{p.icon}</span>
              <div>
                <h3 className="text-sm font-semibold">{p.title}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{p.body}</p>
              </div>
            </div>
          ))}
        </div>

        <footer className="mt-4 text-center text-xs text-muted-foreground">
          Powered by MiroMind <code className="rounded bg-muted px-1 py-0.5 font-mono">mirothinker-1-7-deepresearch</code> via the Responses API.
        </footer>
      </main>
    </>
  );
}
