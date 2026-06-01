import type { Job } from "@/lib/types";
import { stepIcon } from "@/lib/colors";
import { ConfidenceBreakdown } from "@/components/confidence-breakdown";
import { safeHttpUrl } from "@/lib/url";
import { useArgusStore } from "@/lib/store";
import { stepOrdinals } from "@/lib/steps";

interface Props {
  job: Job;
  findingId: string | null;
}

export function EvidenceTab({ job, findingId }: Props) {
  const setHighlightedStep = useArgusStore((s) => s.setHighlightedStep);
  const setConsoleMode = useArgusStore((s) => s.setConsoleMode);

  // Jump the Zone-3 console to the DAG and focus the producing step.
  const jumpToStep = (stepId: string) => {
    setHighlightedStep(stepId);
    setConsoleMode("graph");
  };

  if (findingId === null) {
    return <Empty />;
  }
  const finding = job.findings.find((f) => f.id === findingId);
  if (!finding) return <Empty />;

  const claim = job.claims.find((c) => c.id === finding.claim_id);
  const trace = job.traces.find((t) => t.id === finding.reasoning_trace_id);
  const evidences = job.evidences.filter((e) => finding.evidence_ids.includes(e.id));
  // Small 1-based step labels ("step 3") in place of the large raw `sequence`.
  const ordinals = trace ? stepOrdinals(trace.steps) : new Map<string, number>();

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
            <li key={s.id}>
              <button
                type="button"
                onClick={() => jumpToStep(s.id)}
                aria-label={`Show step ${ordinals.get(s.id) ?? 0} in the reasoning graph`}
                className="flex w-full gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span aria-hidden>{stepIcon[s.type]}</span>
                <span>{s.summary}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      {finding.why_wrong && (
        <section>
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Why it&apos;s wrong
          </h2>
          <p className="mt-1 text-sm leading-relaxed">{finding.why_wrong}</p>
        </section>
      )}

      {finding.correct_information && (
        <section>
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Correct information
          </h2>
          <p className="mt-1 text-sm leading-relaxed">{finding.correct_information.value}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
            <span className="uppercase tracking-wider">Source:</span>
            {safeHttpUrl(finding.correct_information.url) ? (
              <a
                href={safeHttpUrl(finding.correct_information.url)!}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline-offset-2 hover:underline"
              >
                {finding.correct_information.source}
              </a>
            ) : (
              <span>{finding.correct_information.source}</span>
            )}
            {finding.correct_information.retrieved_date && (
              <span className="text-[10px] opacity-70">
                · retrieved {finding.correct_information.retrieved_date}
              </span>
            )}
          </p>
        </section>
      )}

      {finding.confidence_breakdown && (
        <section>
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Confidence breakdown
          </h2>
          <div className="mt-2">
            <ConfidenceBreakdown breakdown={finding.confidence_breakdown} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Evidence ({evidences.length})
        </h2>
        <ul className="mt-2 space-y-2 text-sm">
          {evidences.map((e) => {
            const producingStep = trace?.steps.find((s) => s.id === e.retrieved_by_step_id);
            return (
              <li key={e.id} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-muted-foreground">{e.source_type}</span>
                    {producingStep && (
                      <button
                        type="button"
                        onClick={() => jumpToStep(e.retrieved_by_step_id)}
                        aria-label={`Show step ${ordinals.get(producingStep.id) ?? 0} in the reasoning graph`}
                        className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        step {ordinals.get(producingStep.id) ?? 0}
                      </button>
                    )}
                  </span>
                  {safeHttpUrl(e.url) ? (
                    <a
                      href={safeHttpUrl(e.url)!}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                    >
                      {e.citation}
                    </a>
                  ) : e.citation ? (
                    <span className="text-xs text-muted-foreground">{e.citation}</span>
                  ) : null}
                </div>
                {e.snippet && (
                  <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{e.snippet}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Empty() {
  return <p className="p-6 text-sm text-muted-foreground">Select a finding to see its evidence.</p>;
}
