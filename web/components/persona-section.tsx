const PERSONAS = [
  {
    title: "Legal & compliance",
    body: "Opposing counsel filed a brief drafted with AI. Flag fabricated cases before you cite them back. Evidence trail built to file.",
  },
  {
    title: "AI governance",
    body: "Your analysts paste ChatGPT into board memos. Argus is the checkpoint between 'the model said it' and 'we signed off on it'.",
  },
  {
    title: "Investment & research",
    body: "A 40-page AI research note arrived from a vendor. You can't read it all; you can't trust it all. Argus surfaces only what's wrong.",
  },
];

export function PersonaSection() {
  return (
    <section
      aria-labelledby="who-uses-argus"
      className="w-full"
    >
      <h2
        id="who-uses-argus"
        className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Who uses Argus
      </h2>
      <div className="grid w-full gap-3 md:grid-cols-3">
        {PERSONAS.map((p) => (
          <div
            key={p.title}
            className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--shadow-card)]"
          >
            <h3 className="text-sm font-semibold">{p.title}</h3>
            <p className="text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
