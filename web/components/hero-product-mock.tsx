/**
 * Light "browser frame" hero mock — a static snapshot of the *real* cockpit:
 * three real findings from the bundled NVIDIA sample audit on the left, the
 * audit pipeline on the right. No fabricated data; values match the fixture.
 */

const FINDINGS: { verdict: string; severity: string; confidence: number; claim: string; summary: string }[] = [
  {
    verdict: "fabricated",
    severity: "major",
    confidence: 0.93,
    claim: 'Goldman Sachs report "Silicon Supercycle: The $5 Trillion AI Buildout"',
    summary: "No record of any such report — the citation invents both the title and its attribution.",
  },
  {
    verdict: "inaccurate",
    severity: "major",
    confidence: 0.99,
    claim: "Data-center revenue of $148B in fiscal 2025",
    summary: "Impossible — it exceeds NVIDIA's $130.5B total revenue for the same year.",
  },
  {
    verdict: "inaccurate",
    severity: "major",
    confidence: 0.96,
    claim: "Hopper is NVIDIA's most advanced GPU architecture",
    summary: "Superseded by the Blackwell architecture, in production since 2024.",
  },
];

const STAGES: { n: number; name: string; engine: string }[] = [
  { n: 1, name: "Parse", engine: "rules" },
  { n: 2, name: "Atomizer", engine: "deepseek" },
  { n: 3, name: "Check-worthiness", engine: "deepseek" },
  { n: 4, name: "Review gate", engine: "hitl" },
  { n: 5, name: "Verify", engine: "miromind" },
  { n: 6, name: "Consistency", engine: "deepseek" },
  { n: 7, name: "Reporter", engine: "deepseek" },
];

const ENGINE_CLS: Record<string, string> = {
  miromind: "bg-primary/15 text-primary",
  deepseek: "bg-muted text-muted-foreground",
  rules: "bg-muted text-muted-foreground",
  hitl: "bg-warning/15 text-warning-foreground",
};
const ENGINE_LABEL: Record<string, string> = {
  miromind: "★ MiroMind",
  deepseek: "DeepSeek",
  rules: "rules",
  hitl: "gate",
};

export function HeroProductMock() {
  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-background shadow-[var(--shadow-card-hover)]">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="ml-4 flex-1 rounded-md bg-background px-3 py-1 text-[11px] text-muted-foreground">
            argus-truth-engine.vercel.app/audit
          </span>
        </div>

        {/* Two columns: real findings + audit pipeline */}
        <div className="grid grid-cols-[1fr_188px] divide-x divide-border">
          <div className="space-y-2.5 p-4 text-left">
            {FINDINGS.map((f) => (
              <div
                key={f.claim}
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-destructive-foreground">
                    {f.verdict}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {f.severity} · {f.confidence.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] font-medium leading-snug text-foreground">{f.claim}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{f.summary}</p>
              </div>
            ))}
          </div>

          <div className="p-3 text-left">
            <p className="mb-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Audit pipeline
            </p>
            <ol className="space-y-2">
              {STAGES.map((s) => (
                <li key={s.n} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-3 shrink-0 text-center font-mono text-[9px] text-muted-foreground">{s.n}</span>
                  <span className="flex-1 truncate text-foreground">{s.name}</span>
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-medium ${ENGINE_CLS[s.engine]}`}>
                    {ENGINE_LABEL[s.engine]}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
