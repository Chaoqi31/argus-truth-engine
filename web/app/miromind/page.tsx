import Link from "next/link";
import { ArgusHeader } from "@/components/argus-header";

export const metadata = {
  title: "Powered by MiroMind — Argus",
  description: "How Argus uses MiroMind's mirothinker deep-research model to verify factual claims.",
};

const PILLARS: { title: string; body: string }[] = [
  {
    title: "Autonomous, per claim",
    body: "The model decides how to investigate each claim — which queries to run, which pages to open, when to compute. Chasing one fabricated citation, it fired 77 distinct searches (exact titles, site filters, file types, paraphrases) before concluding the report was invented. No hard-coded search path.",
  },
  {
    title: "A trace you can trust",
    body: "Every search, fetch, and thought is streamed and recorded as it happens. A stateful SSE decoder stitches events back together across network packets, so the saved reasoning is exactly what the model did — no dropped steps, no mangled source URLs.",
  },
  {
    title: "Parallel, idempotent, capped",
    body: "Claims run concurrently, each as its own background job. Deterministic idempotency keys make retries safe, and a hard budget cap stops a long audit before spend can run away.",
  },
  {
    title: "Reserved for the verdict",
    body: "Only verification calls MiroMind. Parsing, claim extraction, the consistency check, and report writing run on a cheaper model — so deep research is spent on the answer, never the plumbing.",
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
            Verifying a factual claim isn&apos;t a database lookup — it&apos;s research. Argus hands each
            one to MiroMind&apos;s{" "}
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-base text-foreground">mirothinker-1-7-deepresearch</span>,
            an agentic model that searches the live web, opens sources, and reasons its way to a
            verdict — then shows its work.
          </p>
          <p className="mt-8 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Tools the model calls on its own
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
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
            <span className="font-semibold">One MiroMind call per claim</span>{" "}
            <span className="text-muted-foreground">— and the verifier is the only thing that ever calls it.</span>
          </p>
        </div>

        {/* CTA */}
        <section className="border-t border-border py-20 text-center mt-16">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">See the reasoning, end to end.</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Every search, fetch, and step is recorded and replayable in the audit cockpit —
            grouped by claim, down to each source link.
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
