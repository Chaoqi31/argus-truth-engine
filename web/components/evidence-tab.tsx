import type { Job } from "@/lib/types";
import { stepIcon } from "@/lib/colors";

interface Props {
  job: Job;
  findingId: string | null;
}

export function EvidenceTab({ job, findingId }: Props) {
  if (findingId === null) {
    return <Empty />;
  }
  const finding = job.findings.find((f) => f.id === findingId);
  if (!finding) return <Empty />;

  const claim = job.claims.find((c) => c.id === finding.claim_id);
  const trace = job.traces.find((t) => t.id === finding.reasoning_trace_id);
  const evidences = job.evidences.filter((e) => finding.evidence_ids.includes(e.id));

  return (
    <div className="space-y-6 p-4">
      <section>
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Claim</h2>
        <p className="mt-1 text-base">{claim?.text ?? "(claim missing)"}</p>
        {claim && claim.page > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">page {claim.page}</p>
        )}
      </section>

      <section>
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Why this verdict
        </h2>
        <ol className="mt-2 space-y-1 text-sm">
          {trace?.steps.map((s) => (
            <li key={s.id} className="flex gap-2">
              <span aria-hidden>{stepIcon[s.type]}</span>
              <span>{s.summary}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Evidence ({evidences.length})
        </h2>
        <ul className="mt-2 space-y-2 text-sm">
          {evidences.map((e) => (
            <li key={e.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{e.source_type}</span>
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    {e.citation}
                  </a>
                )}
              </div>
              {e.snippet && (
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{e.snippet}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Empty() {
  return <p className="p-6 text-sm text-muted-foreground">Select a finding to see its evidence.</p>;
}
