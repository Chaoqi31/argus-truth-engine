"use client";

import { useRouter } from "next/navigation";
import { useArgusStore } from "@/lib/store";
import { loadJobFromFile, loadSampleJob } from "@/lib/load-job";
import { ArgusHeader } from "@/components/argus-header";

export default function HomePage() {
  const router = useRouter();
  const setJob = useArgusStore((s) => s.setJob);

  const trySample = async () => {
    const job = await loadSampleJob();
    setJob(job);
    router.push("/audit");
  };

  const onPicked = async (file: File) => {
    const job = await loadJobFromFile(file);
    setJob(job);
    router.push("/audit");
  };

  return (
    <>
      <ArgusHeader />
      <main className="mx-auto flex max-w-2xl flex-col items-center gap-8 px-6 py-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Audit a research report.
          <br />
          See every reasoning step.
        </h1>
        <p className="max-w-xl text-muted-foreground">
          Argus surfaces fabricated citations, misaligned quotes, stale data and
          internal contradictions in PDF research reports — and shows the full
          reasoning chain MiroMind used to reach each verdict.
        </p>
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={trySample}
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Try the sample audit
          </button>
          <label className="cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:underline">
            …or drop a findings.json
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPicked(f);
              }}
            />
          </label>
        </div>
      </main>
    </>
  );
}
