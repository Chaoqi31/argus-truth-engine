"use client";

import { ArgusHeader } from "@/components/argus-header";
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
    body: "Fabricated references, misrepresented sources, outdated data, and internal contradictions — each with a specialized verification agent.",
  },
  {
    title: "Full reasoning transparency",
    body: "Every web search, every fetched source, every chain-of-thought step is recorded and visible. Not a black-box score — a readable audit trail.",
  },
  {
    title: "Adversarial debate protocol",
    body: "Each high-stakes finding is stress-tested by an Attacker / Defender / Judge debate. The transcript ships with the report so reviewers see both sides.",
  },
  {
    title: "Exportable audit report",
    body: "Download findings as a styled PDF, structured JSON, or Markdown summary — ready to file, attach, or integrate into your workflow.",
  },
];

export default function ForTeamsPage() {
  const heroReveal = useScrollReveal(0.05);
  const personasReveal = useScrollReveal(0.1);
  const featuresReveal = useScrollReveal(0.1);

  return (
    <>
      <ArgusHeader />
      <main className="mx-auto flex max-w-5xl flex-col gap-0 px-6">
        {/* Hero */}
        <header
          ref={heroReveal.ref}
          className={`py-20 text-center transition-all duration-700 ${heroReveal.isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">For teams</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            For teams that receive AI output.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Argus is the audit layer between someone else&apos;s AI and your sign-off.
          </p>
        </header>

        {/* Personas */}
        <section ref={personasReveal.ref} className="pb-20">
          <p className={`mb-6 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-all duration-700 ${personasReveal.isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
            Who uses Argus
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {PERSONAS.map((p, i) => (
              <div
                key={p.title}
                className={`group rounded-xl border border-border bg-background p-6 shadow-[var(--shadow-card)] transition-all duration-500 hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5 ${personasReveal.isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}
                style={{ transitionDelay: `${i * 120}ms` }}
              >
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                  {p.icon}
                </div>
                <h3 className="font-semibold">{p.title}</h3>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden>
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section ref={featuresReveal.ref} className="pb-24">
          <p className={`mb-6 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-all duration-700 ${featuresReveal.isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
            What it does
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`rounded-xl border border-border bg-background p-6 shadow-[var(--shadow-card)] transition-all duration-500 hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5 ${featuresReveal.isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}
                style={{ transitionDelay: `${i * 100}ms` }}
              >
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
