/**
 * Light "browser frame" hero mock — a static snapshot that mirrors the real
 * cockpit: three real findings from the NVIDIA sample audit (cockpit card
 * treatment) on the left, the audit pipeline on the right. Values match the
 * fixture; no fabricated data.
 */

const FINDINGS: { verdict: string; severity: string; confidence: number; claim: string; summary: string }[] = [
  {
    verdict: "fabricated", severity: "major", confidence: 0.93,
    claim: 'Goldman Sachs report "Silicon Supercycle: The $5 Trillion AI Buildout"',
    summary: "No record of any such report — the citation invents both the title and its attribution.",
  },
  {
    verdict: "inaccurate", severity: "major", confidence: 0.99,
    claim: "Data-center revenue of $148B in fiscal 2025",
    summary: "Impossible — it exceeds NVIDIA's $130.5B total revenue for the same year.",
  },
  {
    verdict: "inaccurate", severity: "major", confidence: 0.96,
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
  hitl: "bg-[color-mix(in_oklab,var(--cc-warn,#d18700)_15%,transparent)] text-[var(--cc-warn,#d18700)]",
};
const ENGINE_LABEL: Record<string, string> = {
  miromind: "★ MiroMind", deepseek: "DeepSeek", rules: "rules", hitl: "gate",
};

export function HeroProductMock() {
  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <div className="overflow-hidden rounded-[14px] border border-border bg-background shadow-[var(--shadow-card-hover)]">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="ml-3 flex-1 rounded-md border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
            argus-truth-engine.vercel.app/audit
          </span>
        </div>

        {/* Findings + pipeline */}
        <div className="grid grid-cols-[1fr_196px] divide-x divide-border">
          <div className="space-y-2.5 p-4 text-left">
            {FINDINGS.map((f) => (
              <div
                key={f.claim}
                className="relative overflow-hidden rounded-[10px] border border-border bg-background shadow-[var(--shadow-card)]"
              >
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--cc-danger,#d92d20)]" />
                <div className="p-3 pl-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider bg-[color-mix(in_oklab,var(--cc-danger,#d92d20)_15%,transparent)] text-[var(--cc-danger,#d92d20)]">
                      {f.verdict}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {f.severity} · {f.confidence.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] font-medium leading-snug text-foreground">{f.claim}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.summary}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-muted/30 p-4 text-left">
            <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Audit pipeline
            </p>
            <ol className="space-y-2.5">
              {STAGES.map((s) => {
                const hot = s.engine === "miromind";
                return (
                  <li key={s.n} className={`flex items-center gap-2 text-[11px] ${hot ? "font-semibold" : ""}`}>
                    <span className="w-3 shrink-0 text-center font-mono text-[9px] text-muted-foreground">{s.n}</span>
                    <span className={`flex-1 truncate ${hot ? "text-foreground" : "text-muted-foreground"}`}>{s.name}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-medium ${ENGINE_CLS[s.engine]}`}>
                      {ENGINE_LABEL[s.engine]}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
