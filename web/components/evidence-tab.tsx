import type {
  ClaimCoverage,
  ComputationCheck,
  Evidence,
  EvidenceQuality,
  FindingReasoningStep,
  Job,
  ReviewerStatus,
  SkepticReview,
} from "@/lib/types";
import { stepIcon } from "@/lib/colors";
import { ConfidenceBreakdown } from "@/components/confidence-breakdown";
import { getFindingAuditability, type FindingAuditability } from "@/lib/auditability";
import { safeHttpUrl } from "@/lib/url";
import { useArgusStore } from "@/lib/store";
import { stepOrdinals } from "@/lib/steps";

interface Props {
  job: Job;
  findingId: string | null;
}

export function EvidenceTab({ job, findingId }: Props) {
  // Jump the Zone-3 console to the DAG and focus the producing step.
  const jumpToStep = useArgusStore((s) => s.jumpToStep);
  const setEvidenceDiff = useArgusStore((s) => s.setEvidenceDiff);
  const reviews = useArgusStore((s) => s.findingReviews);
  const setFindingReview = useArgusStore((s) => s.setFindingReview);

  if (findingId === null) {
    return <Empty />;
  }
  const finding = job.findings.find((f) => f.id === findingId);
  if (!finding) return <Empty />;

  const claim = job.claims.find((c) => c.id === finding.claim_id);
  const trace = job.traces.find((t) => t.id === finding.reasoning_trace_id);
  const evidences = job.evidences.filter((e) => finding.evidence_ids.includes(e.id));
  const reasoningChain = finding.reasoning_chain ?? [];
  const coverage = finding.coverage ?? [];
  const auditability = getFindingAuditability(job, finding);
  const review = reviews[finding.id] ?? { status: "open" as const, note: "", updated_at: "" };
  const qualityByEvidence = new Map(
    (finding.evidence_quality ?? []).map((q) => [q.evidence_id, q]),
  );
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

      {claim && (finding.correct_information || finding.why_wrong) && (
        <ClaimVerdictCompare
          claimed={claim.text}
          correct={finding.correct_information?.value ?? null}
          rationale={finding.why_wrong ?? finding.summary}
          source={finding.correct_information?.source ?? null}
        />
      )}

      <TransparencyChecklist auditability={auditability} />

      <ReviewDecisionSection
        review={review}
        onStatus={(status) => setFindingReview(job.id, finding.id, { status })}
        onNote={(note) => setFindingReview(job.id, finding.id, { note })}
      />

      {reasoningChain.length > 0 && (
        <section>
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Reasoning summary
          </h2>
          <ol className="mt-2 space-y-2 text-sm">
            {reasoningChain.map((step, i) => (
              <ReasoningSummaryItem key={i} step={step} index={i + 1} />
            ))}
          </ol>
        </section>
      )}

      {finding.computation_check && (
        <ComputationCheckSection check={finding.computation_check} />
      )}

      {coverage.length > 0 && (
        <CoverageMatrix coverage={coverage} evidences={evidences} />
      )}

      {finding.skeptic_review && (
        <SkepticReviewSection review={finding.skeptic_review} />
      )}

      {finding.verdict === "fabricated" && trace && (
        <SearchTrailSection steps={trace.steps} />
      )}

      <section>
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Trace steps
        </h2>
        <ol className="mt-2 space-y-1 text-sm">
          {trace?.steps.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => jumpToStep(s.id)}
                aria-label={`Show step ${ordinals.get(s.id) ?? 0} in the trace`}
                className="flex min-w-0 w-full gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span aria-hidden>{stepIcon[s.type]}</span>
                <span className="min-w-0 break-words">{s.summary}</span>
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

      {finding.confidence_breakdown && finding.evidence_ids.length > 0 && (
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
            const quality = qualityByEvidence.get(e.id);
            return (
              <li key={e.id} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-muted-foreground">{e.source_type}</span>
                    {producingStep && (
                      <button
                        type="button"
                        onClick={() => jumpToStep(e.retrieved_by_step_id)}
                        aria-label={`Show step ${ordinals.get(producingStep.id) ?? 0} in the trace`}
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
                      className="min-w-0 break-all text-right text-xs text-primary underline-offset-2 hover:underline"
                    >
                      {e.citation}
                    </a>
                  ) : e.citation ? (
                    <span className="min-w-0 break-all text-xs text-muted-foreground">{e.citation}</span>
                  ) : null}
                </div>
                {e.snippet && (
                  <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{e.snippet}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <SourceBadge evidence={e} quality={quality} />
                  <FreshnessBadge evidence={e} quality={quality} />
                  <button
                    type="button"
                    onClick={() => setEvidenceDiff({ findingId: finding.id, evidenceId: e.id })}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    compare
                  </button>
                </div>
                {quality && <EvidenceQualityBlock quality={quality} />}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

const REVIEW_OPTIONS: Array<{ status: ReviewerStatus; label: string }> = [
  { status: "open", label: "Open" },
  { status: "accepted", label: "Accepted" },
  { status: "disputed", label: "Disputed" },
  { status: "needs-recheck", label: "Needs recheck" },
  { status: "resolved", label: "Resolved" },
];

const AUDITABILITY_BADGE = {
  present: "bg-success/15 text-success",
  missing: "bg-destructive/15 text-destructive-foreground",
  not_applicable: "bg-muted text-muted-foreground",
} as const;

const AUDITABILITY_LABEL = {
  present: "Present",
  missing: "Missing",
  not_applicable: "N/A",
} as const;

function TransparencyChecklist({ auditability }: { auditability: FindingAuditability }) {
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Transparency checklist
        </h2>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {auditability.presentCount}/{auditability.requiredCount} controls present
        </span>
      </div>
      <ul className="mt-2 grid gap-1.5">
        {auditability.controls.map((control) => (
          <li
            key={control.id}
            className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-[11px]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">{control.label}</span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${AUDITABILITY_BADGE[control.status]}`}
              >
                {AUDITABILITY_LABEL[control.status]}
              </span>
            </div>
            <p className="mt-0.5 text-muted-foreground">{control.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewDecisionSection({
  review,
  onStatus,
  onNote,
}: {
  review: { status: ReviewerStatus; note: string; updated_at: string };
  onStatus: (status: ReviewerStatus) => void;
  onNote: (note: string) => void;
}) {
  return (
    <section>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        Review decision
      </h2>
      <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2">
        <div className="flex flex-wrap gap-1">
          {REVIEW_OPTIONS.map((option) => (
            <button
              key={option.status}
              type="button"
              onClick={() => onStatus(option.status)}
              aria-pressed={review.status === option.status}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                review.status === option.status
                  ? "bg-primary text-white"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <textarea
          value={review.note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Reviewer note..."
          className="min-h-20 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {review.updated_at ? `Last updated locally ${review.updated_at.slice(0, 10)}` : "Not saved yet"}
        </p>
      </div>
    </section>
  );
}

function ClaimVerdictCompare({
  claimed,
  correct,
  rationale,
  source,
}: {
  claimed: string;
  correct: string | null;
  rationale: string;
  source: string | null;
}) {
  return (
    <section>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        Claimed vs verified
      </h2>
      <div className="mt-2 grid gap-2">
        <div className="rounded-md border border-border bg-muted/30 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Claimed
          </p>
          <p className="mt-1 text-sm leading-relaxed">{claimed}</p>
        </div>
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
            {correct ? "Verified correction" : "Verification result"}
          </p>
          <p className="mt-1 text-sm leading-relaxed">{correct ?? rationale}</p>
          {source && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Source: {source}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SearchTrailSection({ steps }: { steps: Job["traces"][number]["steps"] }) {
  const trail = steps.filter((s) => s.type === "web_search" || s.type === "fetch_url_content");
  if (trail.length === 0) return null;
  return (
    <section>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        Search trail
      </h2>
      <ol className="mt-2 space-y-1.5 text-xs">
        {trail.map((s) => (
          <li key={s.id} className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
            <p className="flex items-start gap-1.5">
              <span aria-hidden>{stepIcon[s.type]}</span>
              <span className="min-w-0 flex-1 break-words">{s.summary}</span>
              {s.type === "web_search" && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {searchResultCount(s.content)} results
                </span>
              )}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function searchResultCount(content: Record<string, unknown>): number {
  const raw = content.result;
  if (typeof raw !== "string") return 0;
  try {
    const parsed = JSON.parse(raw) as { organic?: unknown };
    return Array.isArray(parsed.organic) ? parsed.organic.length : 0;
  } catch {
    return 0;
  }
}

function ComputationCheckSection({ check }: { check: ComputationCheck }) {
  return (
    <section>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {check.kind === "date" ? "Date validity check" : "Computation check"}
      </h2>
      <div className="mt-2 space-y-2 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {check.claimed_value && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              claimed: {check.claimed_value}
            </span>
          )}
          {check.computed_value && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
              computed: {check.computed_value}
            </span>
          )}
          {check.judgment && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              {check.judgment}
            </span>
          )}
        </div>
        {check.extracted_values.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {check.extracted_values.map((v, i) => (
              <li key={`${v.label}-${i}`}>
                <span className="font-medium text-foreground">{v.label}: </span>
                {v.value}
                {v.unit ? ` ${v.unit}` : ""}
              </li>
            ))}
          </ul>
        )}
        {check.formula && (
          <p className="rounded bg-muted px-2 py-1 font-mono text-xs">{check.formula}</p>
        )}
        {check.rationale && (
          <p className="text-xs leading-relaxed text-muted-foreground">{check.rationale}</p>
        )}
      </div>
    </section>
  );
}

function CoverageMatrix({
  coverage,
  evidences,
}: {
  coverage: ClaimCoverage[];
  evidences: Evidence[];
}) {
  const evidenceById = new Map(evidences.map((e) => [e.id, e]));
  return (
    <section>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        Coverage matrix
      </h2>
      <ul className="mt-2 space-y-2 text-sm">
        {coverage.map((row, i) => (
          <li key={`${row.claim_fragment}-${i}`} className="rounded-md border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 leading-relaxed">{row.claim_fragment}</p>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
                {row.relation}
              </span>
            </div>
            {row.reason && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.reason}</p>
            )}
            {row.evidence_ids.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                {row.evidence_ids.map((id) => (
                  <span key={id} className="rounded border border-border px-1">
                    {evidenceById.get(id)?.citation || id}
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SkepticReviewSection({ review }: { review: SkepticReview }) {
  return (
    <section>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        Skeptic review
      </h2>
      <div className="mt-2 space-y-2 text-sm">
        <span className="inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
          {review.status.replaceAll("_", " ")}
        </span>
        <p className="leading-relaxed">{review.summary}</p>
        {review.counterevidence.length > 0 && (
          <ul className="space-y-1.5">
            {review.counterevidence.map((ce, i) => {
              const href = safeHttpUrl(ce.url);
              return (
                <li key={`${ce.source}-${i}`} className="rounded-md border border-border p-2 text-xs">
                  <p className="font-medium text-foreground">{ce.source}</p>
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="break-all text-primary underline-offset-2 hover:underline"
                    >
                      {ce.url}
                    </a>
                  )}
                  {ce.snippet && <p className="mt-1 text-muted-foreground">{ce.snippet}</p>}
                  {ce.relevance && <p className="mt-1 text-muted-foreground">{ce.relevance}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function EvidenceQualityBlock({ quality }: { quality: EvidenceQuality }) {
  return (
    <div className="mt-2 rounded bg-muted/60 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Evidence quality
        </span>
        <QualityScore label="authority" value={quality.authority} />
        <QualityScore label="independence" value={quality.independence} />
        <QualityScore label="directness" value={quality.directness} />
        <QualityScore label="freshness" value={quality.freshness} />
      </div>
      {quality.rationale && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{quality.rationale}</p>
      )}
    </div>
  );
}

function SourceBadge({
  evidence,
  quality,
}: {
  evidence: Evidence;
  quality?: EvidenceQuality;
}) {
  const label = sourceAuthorityLabel(evidence, quality);
  return (
    <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
  );
}

function FreshnessBadge({
  evidence,
  quality,
}: {
  evidence: Evidence;
  quality?: EvidenceQuality;
}) {
  const pct = quality ? Math.round(quality.freshness * 100) : null;
  return (
    <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {pct !== null ? `freshness ${pct}%` : `retrieved ${shortDate(evidence.retrieved_at)}`}
    </span>
  );
}

function sourceAuthorityLabel(evidence: Evidence, quality?: EvidenceQuality): string {
  if (quality?.role) return quality.role.replaceAll("_", " ");
  if (["crossref", "sec_edgar", "fred", "worldbank", "imf"].includes(evidence.source_type)) {
    return "authoritative source";
  }
  if (["arxiv", "ssrn"].includes(evidence.source_type)) return "academic source";
  if (evidence.source_type === "company_filing") return "primary filing";
  if (evidence.source_type === "internal_doc") return "internal source";
  return "web source";
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}

function QualityScore({ label, value }: { label: string; value: number }) {
  return (
    <span className="font-mono text-[10px] text-muted-foreground">
      {label} {Math.round(value * 100)}%
    </span>
  );
}

function ReasoningSummaryItem({
  step,
  index,
}: {
  step: FindingReasoningStep;
  index: number;
}) {
  if ("action" in step) {
    return (
      <li className="border-l border-border pl-3">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {index}. Action
        </p>
        <p className="mt-0.5 leading-relaxed">{step.action}</p>
        {step.observation && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Observation: </span>
            {step.observation}
          </p>
        )}
        {step.reasoning && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Reasoning: </span>
            {step.reasoning}
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="border-l border-border pl-3">
      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {index}. {step.step}
      </p>
      <p className="mt-0.5 leading-relaxed">{step.content}</p>
      {step.evidence_ref && (
        <p className="mt-1 font-mono text-xs text-muted-foreground">{step.evidence_ref}</p>
      )}
    </li>
  );
}

function Empty() {
  return <p className="p-6 text-sm text-muted-foreground">Select a finding to see its evidence.</p>;
}
