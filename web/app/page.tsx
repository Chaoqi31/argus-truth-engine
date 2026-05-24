"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useArgusStore } from "@/lib/store";
import { loadSampleJob } from "@/lib/load-job";
import {
  uploadPdf,
  submitText,
  UnsupportedMediaTypeError,
  ArgusApiError,
  type ContentDomain,
} from "@/lib/api";
import { ArgusHeader } from "@/components/argus-header";
import { ApiKeyInput } from "@/components/api-key-input";

const POINTS = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5 text-primary" aria-hidden>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <path d="M8 7h8M8 11h8M8 15h5"/>
      </svg>
    ),
    title: "Fabricated references",
    body: "Cross-checks citations against authoritative databases — papers, court cases, clinical trials, or filings that don't actually exist.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5 text-primary" aria-hidden>
        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
      </svg>
    ),
    title: "Misrepresented sources",
    body: "Fetches the original source and compares what was claimed vs. what was actually said.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5 text-primary" aria-hidden>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
        <polyline points="17 6 23 6 23 12"/>
      </svg>
    ),
    title: "Outdated data",
    body: "Verifies statistics, figures, and dates against live authoritative sources in any domain.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5 text-primary" aria-hidden>
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4M12 16h.01"/>
      </svg>
    ),
    title: "Internal contradictions",
    body: "Detects claims within the text that contradict each other or established facts.",
  },
];

type LoadingKind = "upload" | "sample" | null;
type InputMode = "text" | "pdf";

export default function HomePage() {
  const router = useRouter();
  const setJob = useArgusStore((s) => s.setJob);
  const resetLive = useArgusStore((s) => s.resetLive);
  const [loading, setLoading] = useState<LoadingKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [textInput, setTextInput] = useState("");
  const [contentDomain, setContentDomain] = useState<ContentDomain>("general");

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

  const onSubmitText = async () => {
    if (!apiKey.trim()) {
      setError("Please paste your MiroMind API key above first.");
      return;
    }
    if (textInput.trim().length < 50) {
      setError("Text must be at least 50 characters.");
      return;
    }
    setLoading("upload");
    setError(null);
    try {
      const { job_id } = await submitText(textInput, apiKey, { contentDomain });
      resetLive();
      router.push(`/audit?id=${encodeURIComponent(job_id)}&mode=text`);
    } catch (e) {
      if (e instanceof ArgusApiError) {
        setError(`API error: ${e.message}`);
      } else if (e instanceof Error) {
        setError(`Could not reach the Argus API. Is \`argus serve\` running? (${e.message})`);
      } else {
        setError(String(e));
      }
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
            For compliance, legal, and research teams that receive AI output
          </span>
          <h1 className="text-balance text-5xl font-semibold tracking-tight md:text-6xl">
            The audit layer for
            <br />
            <span className="text-primary">AI-generated content.</span>
          </h1>
          <p className="max-w-2xl text-balance text-base text-muted-foreground md:text-lg">
            Patronus and Galileo help you <em>build</em> AI you can ship.
            Argus helps you <em>trust</em> AI someone else shipped to you.
            Upload any AI-generated PDF or paste any LLM output — get every factual claim,
            every verdict, and the full reasoning chain behind it.
          </p>

          <div className="mt-2 flex w-full max-w-xl flex-col items-center gap-3">
            <ApiKeyInput value={apiKey} onChange={setApiKey} />

            {/* Tab toggle */}
            <div className="flex w-full rounded-lg border border-border bg-muted/50 p-0.5">
              <button
                type="button"
                onClick={() => { setInputMode("text"); setError(null); }}
                className={
                  "flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors " +
                  (inputMode === "text"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                Paste Text
              </button>
              <button
                type="button"
                onClick={() => { setInputMode("pdf"); setError(null); }}
                className={
                  "flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors " +
                  (inputMode === "pdf"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                Upload PDF
              </button>
            </div>

            {/* Text input */}
            {inputMode === "text" && (
              <div className="flex w-full flex-col gap-2">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={loading !== null}
                  placeholder="Paste LLM-generated content here (research report, article, analysis…)"
                  className="h-48 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <div className="flex items-center gap-2">
                  <label htmlFor="domain-select" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                    Content domain
                  </label>
                  <select
                    id="domain-select"
                    value={contentDomain}
                    onChange={(e) => setContentDomain(e.target.value as ContentDomain)}
                    disabled={loading !== null}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                  >
                    <option value="general">General</option>
                    <option value="academic">Academic</option>
                    <option value="medical">Medical</option>
                    <option value="legal">Legal</option>
                    <option value="finance">Finance</option>
                    <option value="technology">Technology</option>
                    <option value="news">News</option>
                    <option value="science">Science</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {textInput.length.toLocaleString()} characters
                  </span>
                  <button
                    type="button"
                    onClick={onSubmitText}
                    disabled={loading !== null || textInput.trim().length < 50}
                    className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
                  >
                    {loading === "upload" ? "Submitting…" : "Check for hallucinations →"}
                  </button>
                </div>
              </div>
            )}

            {/* PDF upload */}
            {inputMode === "pdf" && (
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
            )}

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
              <div className="mt-0.5 shrink-0">{p.icon}</div>
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
