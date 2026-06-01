import Link from "next/link";
import { ArgusHeader } from "@/components/argus-header";

export const metadata = {
  title: "Powered by MiroMind — Argus",
  description: "How Argus uses MiroMind's mirothinker deep-research model to verify factual claims.",
};

const PILLARS: { title: string; body: string }[] = [
  {
    title: "Autonomous research agent",
    body: "Per claim, the model chooses its own tools and strategy — there is no fixed search script. For a fabricated citation it ran 77 distinct searches (exact title, site: filters, file types, paraphrases, alternate sources) before concluding the report never existed.",
  },
  {
    title: "Live, resumable trace",
    body: "Calls run in background mode; every reasoning event is captured and streamed as it happens. A stateful SSE decoder reassembles events split across network chunks, so the trace is faithful — no dropped thoughts, no broken URLs — even across mid-flight reconnects.",
  },
  {
    title: "Parallel, per claim",
    body: "Each claim gets its own deep-research run, fanned out concurrently under a semaphore. Deterministic idempotency keys make retries safe, and a hard budget guard caps spend before it can run away.",
  },
  {
    title: "Web only where it counts",
    body: "Claim extraction, the consistency check, and report writing all run on a cheaper model; parsing, the review gate, and confidence scoring are deterministic. MiroMind's deep research is reserved for the one step that truly needs the open web — the verdict.",
  },
];

const TOOLS = ["thinking", "web_search", "fetch_url_content", "execute_python"];

export default function MiroMindPage() {
  return (
    <>
      <ArgusHeader />
      <main className="mx-auto max-w-5xl px-6">
        {/* Hero */}
        <header className="py-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Powered by MiroMind</p>
          <h1 className="mx-auto mt-3 max-w-2xl text-balance text-4xl font-bold tracking-tight md:text-5xl">
            Deep research, only where it counts.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Argus runs MiroMind&apos;s{" "}
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-base text-foreground">mirothinker-1-7-deepresearch</span>{" "}
            on the one step that needs the open web — verifying each factual claim, one call at a time.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {TOOLS.map((t) => (
              <span key={t} className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        </header>

        {/* Pillars */}
        <div className="grid gap-5 pb-12 md:grid-cols-2">
          {PILLARS.map((p) => (
            <div key={p.title} className="rounded-[var(--radius-card)] border border-border bg-background p-6 shadow-[var(--shadow-card)]">
              <h2 className="text-base font-semibold">{p.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>

        {/* Callout */}
        <div className="rounded-[var(--radius-card)] border border-primary/30 bg-primary-soft px-6 py-5 text-center">
          <p className="text-sm text-foreground">
            <span className="font-semibold">One MiroMind call per claim.</span>{" "}
            <span className="text-muted-foreground">Only the verifier touches MiroMind — every other stage runs off the critical path.</span>
          </p>
        </div>

        {/* CTA */}
        <section className="border-t border-border py-20 text-center mt-16">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Watch it think.</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Every search, fetch, and reasoning step is recorded and replayable in the audit cockpit.
          </p>
          <Link
            href="/audit?demo=1"
            className="mt-7 inline-block cursor-pointer rounded-[12px] bg-primary px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#5741d8]"
          >
            See a sample audit
          </Link>
        </section>
      </main>
    </>
  );
}
