const ROWS = [
  { label: "Planted errors", value: "10" },
  { label: "Caught high-confidence (≥0.90)", value: "3" },
  { label: "Surfaced for human review (≥0.5)", value: "7" },
  { label: "False positives", value: "0" },
];

export function BenchmarkDisclosure() {
  return (
    <section
      aria-labelledby="benchmark"
      className="w-full rounded-[var(--radius-card)] border border-border bg-background p-6 shadow-[var(--shadow-card)]"
    >
      <h2 id="benchmark" className="text-lg font-semibold">
        We publish our recall, not just our wins.
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sample audit: a 9-page CBO budget PDF with 10 deliberately planted errors
        (fabricated citations, misaligned quotes, stale data, contradictions).
        Here is what Argus did, unedited.
      </p>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <td className="py-2 pr-4 text-muted-foreground">{r.label}</td>
              <td className="py-2 text-right font-medium">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Transparency over hype — the planted-error manifest is public so you can
        check our work.
      </p>
    </section>
  );
}
