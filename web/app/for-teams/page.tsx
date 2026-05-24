import { ArgusHeader } from "@/components/argus-header";

const TIERS = [
  {
    name: "Self-serve · BYOK",
    audience: "Solo analysts, hackathon judges, evaluators",
    pitch: "Bring your own MiroMind key. Free to use the hosted UI. Source MIT-licensed.",
    cta: { label: "Try the live demo →", href: "/" },
  },
  {
    name: "Team SaaS",
    audience: "Compliance teams, in-house counsel, research desks",
    pitch: "Shared workspace, role-based access, audit-log retention, SLA on response time. Coming soon.",
    cta: { label: "Join the waitlist", href: "mailto:hello@argus.example" },
  },
  {
    name: "Enterprise · on-prem",
    audience: "Regulated industries (legal, healthcare, finance)",
    pitch: "Run Argus inside your perimeter. Bring your own model provider. Designed for SOC2 and HIPAA boundaries.",
    cta: { label: "Talk to us", href: "mailto:hello@argus.example" },
  },
];

const PERSONAS = [
  {
    title: "Legal & compliance",
    bullets: [
      "Verify cases cited in opposing counsel's AI-drafted briefs",
      "File the Argus evidence trail as part of your response",
      "$110K Oregon sanction in Q1 2026 — Argus is the receipt",
    ],
  },
  {
    title: "AI governance",
    bullets: [
      "Audit checkpoint between 'model said it' and 'we signed off'",
      "92% of Fortune 500 require systematic factuality verification",
      "Per-audit pricing replaces $14K/employee/year of human review",
    ],
  },
  {
    title: "Investment & research",
    bullets: [
      "Triage long AI-generated research notes from vendors",
      "Audit RAG outputs before they enter analyst memos",
      "Surface only the claims that need a human's eyes",
    ],
  },
];

export default function ForTeamsPage() {
  return (
    <>
      <ArgusHeader />
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16">
        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight">For teams that receive AI output.</h1>
          <p className="mt-3 text-muted-foreground">
            Argus is the audit layer between someone else's AI and your sign-off.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {PERSONAS.map((p) => (
            <div key={p.title} className="rounded-[var(--radius-card)] border border-border bg-background p-5">
              <h2 className="font-semibold">{p.title}</h2>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                {p.bullets.map((b) => <li key={b}>• {b}</li>)}
              </ul>
            </div>
          ))}
        </section>

        <section>
          <h2 className="text-2xl font-semibold">How to engage</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {TIERS.map((t) => (
              <div key={t.name} className="flex flex-col rounded-[var(--radius-card)] border border-border bg-background p-5">
                <h3 className="font-semibold">{t.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t.audience}</p>
                <p className="mt-3 flex-1 text-sm">{t.pitch}</p>
                <a href={t.cta.href} className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline">
                  {t.cta.label}
                </a>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
