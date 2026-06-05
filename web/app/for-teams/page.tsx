"use client";

import { ArgusHeader } from "@/components/argus-header";
import { MarketingCtas } from "@/components/marketing-ctas";
import { useScrollReveal } from "@/lib/use-scroll-reveal";

const PERSONAS = [
  {
    title: "Legal & compliance",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
    bullets: [
      "Verify cases cited in opposing counsel's AI-drafted briefs",
      "File the Argus evidence trail as part of your response",
      "Catch fabricated citations before they reach the courtroom",
    ],
  },
  {
    title: "AI governance",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    bullets: [
      "Audit checkpoint between 'model said it' and 'we signed off'",
      "Systematic factuality verification for AI-generated content",
      "Full reasoning chain — every step auditable and traceable",
    ],
  },
  {
    title: "Investment & research",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    bullets: [
      "Triage long AI-generated research notes from vendors",
      "Audit RAG outputs before they enter analyst memos",
      "Surface only the claims that need a human's eyes",
    ],
  },
];

const FEATURES = [
  {
    title: "4 types of error detection",
    body: "Fabricated references, misrepresented sources, and outdated data — caught by an autonomous verifier that picks its own sources and tools per claim — plus internal contradictions flagged by a separate cross-claim consistency check.",
  },
  {
    title: "Full reasoning transparency",
    body: "Every web search, every fetched source, and every reasoning step is recorded and visible. Not a black-box score — a readable audit trail.",
  },
  {
    title: "Decomposed confidence score",
    body: "Every verdict's confidence breaks down into three auditable factors — source authority, evidence freshness, and source agreement — so reviewers can see why a finding is trusted, not just how much.",
  },
  {
    title: "Exportable audit report",
    body: "Download an Audit Pack, Evidence Station JSON, or Executive Markdown — ready to file, attach, or integrate into your workflow.",
  },
];

const CHECK = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden>
    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
  </svg>
);

// Shared entrance: scoped transition on the Enter easing curve + gentle blur-in.
const reveal = (visible: boolean) =>
  `transition-[transform,opacity,filter] duration-[640ms] ease-enter ${
    visible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"
  }`;

export default function ForTeamsPage() {
  const { ref: heroRef, isVisible: heroVisible } = useScrollReveal(0.05);
  const { ref: personasRef, isVisible: personasVisible } = useScrollReveal(0.1);
  const { ref: featuresRef, isVisible: featuresVisible } = useScrollReveal(0.1);

  return (
    <>
      <ArgusHeader />
      <main className="mx-auto flex max-w-5xl flex-col px-6">
        {/* Hero */}
        <header ref={heroRef} className={`py-20 text-center ${reveal(heroVisible)}`}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">For teams</p>
          <h1 className="mx-auto mt-3 max-w-2xl text-balance text-4xl font-bold tracking-tight md:text-5xl">
            For teams that receive AI output.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Argus is the audit layer between someone else&apos;s AI and your sign-off.
          </p>
        </header>

        {/* Personas */}
        <section ref={personasRef} className="pb-20">
          <p className={`mb-8 text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground ${reveal(personasVisible)}`}>
            Who uses Argus
          </p>
          <div className="grid gap-5 md:grid-cols-3">
            {PERSONAS.map((p, i) => (
              <div
                key={p.title}
                className={reveal(personasVisible)}
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <div className="group relative h-full overflow-hidden rounded-[var(--radius-card)] border border-border bg-background p-6 shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow,background-color] duration-300 ease-enter will-change-transform hover:-translate-y-1.5 hover:scale-[1.01] hover:border-primary/35 hover:bg-primary-soft/15 hover:shadow-[0_22px_52px_rgba(102,63,255,0.15)] motion-reduce:transform-none motion-reduce:transition-none">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-primary/70 transition-transform duration-500 ease-enter group-hover:scale-x-100 motion-reduce:hidden"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-y-8 -left-1/3 w-1/3 rotate-12 bg-gradient-to-r from-transparent via-primary/12 to-transparent opacity-0 transition-[transform,opacity] duration-500 ease-enter group-hover:translate-x-[430%] group-hover:opacity-100 motion-reduce:hidden"
                  />
                  <div className="relative mb-4 flex size-11 items-center justify-center rounded-[var(--radius-card)] bg-primary-soft text-primary transition-[transform,background-color,color] duration-300 ease-enter group-hover:-rotate-3 group-hover:scale-110 group-hover:bg-primary group-hover:text-white motion-reduce:transform-none">
                    {p.icon}
                  </div>
                  <h3 className="relative text-base font-semibold transition-[color,transform] duration-300 ease-enter group-hover:translate-x-1 group-hover:text-primary motion-reduce:transform-none">
                    {p.title}
                  </h3>
                  <ul className="relative mt-3 space-y-2 text-sm text-muted-foreground transition-colors duration-300 ease-enter group-hover:text-foreground/80">
                    {p.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2">
                        {CHECK}
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section ref={featuresRef} className="pb-24">
          <p className={`mb-8 text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground ${reveal(featuresVisible)}`}>
            What it does
          </p>
          <div className="grid gap-5 md:grid-cols-2">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={reveal(featuresVisible)}
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div className="group relative h-full overflow-hidden rounded-[var(--radius-card)] border border-border bg-background p-6 shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow,background-color] duration-300 ease-enter will-change-transform hover:-translate-y-1.5 hover:scale-[1.01] hover:border-primary/35 hover:bg-primary-soft/15 hover:shadow-[0_22px_52px_rgba(102,63,255,0.15)] motion-reduce:transform-none motion-reduce:transition-none">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-primary/70 transition-transform duration-500 ease-enter group-hover:scale-x-100 motion-reduce:hidden"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-y-8 -left-1/3 w-1/3 rotate-12 bg-gradient-to-r from-transparent via-primary/12 to-transparent opacity-0 transition-[transform,opacity] duration-500 ease-enter group-hover:translate-x-[430%] group-hover:opacity-100 motion-reduce:hidden"
                  />
                  <h3 className="relative text-base font-semibold transition-[color,transform] duration-300 ease-enter group-hover:translate-x-1 group-hover:text-primary motion-reduce:transform-none">
                    {f.title}
                  </h3>
                  <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground transition-colors duration-300 ease-enter group-hover:text-foreground/80">
                    {f.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border py-20 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Ready to audit your next AI report?</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Run it through Argus before you sign off — fabricated citations and false claims, surfaced with evidence.
          </p>
          <MarketingCtas className="mt-7" />
        </section>
      </main>
    </>
  );
}
