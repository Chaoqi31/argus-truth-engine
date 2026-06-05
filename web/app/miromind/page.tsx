import { ArgusHeader } from "@/components/argus-header";
import { MarketingCtas } from "@/components/marketing-ctas";

export const metadata = {
  title: "Powered by MiroMind — Argus",
  description: "How Argus uses MiroMind's mirothinker deep-research model to verify factual claims.",
};

const PILLARS: { title: string; body: string }[] = [
  {
    title: "Autonomous, per claim",
    body: "The model decides how to investigate each claim — which queries to run, which pages to open, when to compute. In the legal demo, the verifier records 76 web searches across 5 selected claims before producing its verdicts. No hard-coded search path.",
  },
  {
    title: "A trace you can trust",
    body: "Every search, fetch, and reasoning event is streamed and recorded as it happens. A stateful SSE decoder stitches events back together across network packets, so the saved trace reflects what the model did — no dropped steps, no mangled source URLs.",
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
        <div className="grid gap-5 md:grid-cols-2">
          {PILLARS.map((p, index) => (
            <div
              key={p.title}
              className="animate-reveal group relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-background p-6 shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow,background-color] duration-300 ease-enter will-change-transform hover:-translate-y-1.5 hover:scale-[1.01] hover:border-primary/35 hover:bg-primary-soft/20 hover:shadow-[0_22px_52px_rgba(102,63,255,0.15)] motion-reduce:transform-none motion-reduce:transition-none"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-primary/70 transition-transform duration-500 ease-enter group-hover:scale-x-100 motion-reduce:hidden"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-y-8 -left-1/3 w-1/3 rotate-12 bg-gradient-to-r from-transparent via-primary/12 to-transparent opacity-0 transition-[transform,opacity] duration-500 ease-enter group-hover:translate-x-[430%] group-hover:opacity-100 motion-reduce:hidden"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-6 left-0 w-1 origin-top scale-y-0 rounded-r-full bg-primary transition-transform duration-300 ease-enter group-hover:scale-y-100 motion-reduce:hidden"
              />
              <h2 className="relative text-base font-semibold transition-[color,transform] duration-300 ease-enter group-hover:translate-x-1 group-hover:text-primary motion-reduce:transform-none">
                {p.title}
              </h2>
              <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground transition-colors duration-300 ease-enter group-hover:text-foreground/80">
                {p.body}
              </p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <section className="border-t border-border py-20 text-center mt-16">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">See the reasoning, end to end.</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Every search, fetch, and step is recorded and replayable in the audit cockpit —
            grouped by claim, down to each source link.
          </p>
          <MarketingCtas className="mt-7" />
        </section>
      </main>
    </>
  );
}
