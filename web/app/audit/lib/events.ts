// The demo replays a finished job by rebuilding it from its own events, so the
// demo and a live audit run the same fold.
import type { ArgusEvent } from "@/lib/live-job";
import type { Evidence, Job, ReasoningTrace, StageKey } from "@/lib/types";

/** Stages a finished job's events are emitted in. Declaration order is
 * pipeline order; `review` pauses the job, so nothing starts before it. */
const PIPELINE: readonly StageKey[] = [
  "parse",
  "planner",
  "atomizer",
  "checkworthiness",
  "shortlist",
  "review",
  "verify",
  "skeptic",
  "consistency",
  "confidence",
  "reporter",
];

/** The stages whose traces and findings are emitted under them. */
const TRACE_STAGES: readonly StageKey[] = ["verify", "skeptic", "consistency", "confidence"];

const ZERO_USAGE = {
  response_ids: [],
  total_tokens: 0,
  reasoning_tokens: 0,
  num_search_queries: 0,
  cost_usd: 0,
};

export function eventsOf(job: Job): ArgusEvent[] {
  const events: ArgusEvent[] = [];
  const byStage = new Map(job.stages.map((s) => [s.key, s]));
  const evidenceById = new Map(job.evidences.map((e) => [e.id, e]));
  const emitted = new Set<string>();

  const finishStage = (key: StageKey) => {
    const stage = byStage.get(key);
    if (!stage) return;
    events.push({
      type: "stage_finished",
      key: stage.key,
      summary: stage.summary,
      metrics: stage.metrics,
      filtered_claims: stage.filtered_claims,
    });
  };

  const emitFindings = (predicate: (traceId: string) => boolean) => {
    for (const finding of job.findings) {
      if (emitted.has(finding.id) || !predicate(finding.reasoning_trace_id)) continue;
      emitted.add(finding.id);
      events.push({
        type: "finding_recorded",
        finding,
        evidences: cited(finding.evidence_ids, evidenceById),
      });
    }
  };

  const emitTrace = (trace: ReasoningTrace) => {
    events.push({
      type: "trace_opened",
      trace: { ...trace, steps: [], usage: ZERO_USAGE, completed_at: null },
    });
    for (const step of trace.steps) {
      events.push({ type: "step_recorded", trace_id: trace.id, step });
    }
    events.push({
      type: "trace_closed",
      trace_id: trace.id,
      usage: trace.usage,
      completed_at: trace.completed_at ?? job.completed_at ?? job.created_at,
    });
  };

  for (const key of PIPELINE) {
    const stage = byStage.get(key);
    if (!stage) continue;
    events.push({ type: "stage_started", key: stage.key, engine: stage.engine });

    if (key === "review") {
      events.push({ type: "review_ready", claims: job.claims });
      events.push({ type: "claims_selected", claim_ids: job.claims.map((c) => c.id) });
    } else if (TRACE_STAGES.includes(key)) {
      const traces = job.traces.filter((t) => traceStageOf(t) === key);
      for (const trace of traces) {
        emitTrace(trace);
        const ids = new Set([trace.id]);
        emitFindings((traceId) => ids.has(traceId));
      }
    } else if (key === "reporter" && job.audit_report_md !== null) {
      events.push({ type: "report_written", markdown: job.audit_report_md });
    }

    finishStage(key);
  }

  // Anything left cites a trace the pipeline did not emit (a cache hit, or a
  // finding whose trace was dropped). It still belongs to the job.
  emitFindings(() => true);

  events.push({
    type: "finished",
    status: job.status === "failed" ? "failed" : "done",
    failure: job.status === "failed" ? job.failure : null,
    completed_at: job.completed_at ?? job.created_at,
  });
  return events;
}

const AGENT_STAGE: Record<string, StageKey> = {
  verifier: "verify",
  skeptic: "skeptic",
  consistency: "consistency",
};

function traceStageOf(trace: ReasoningTrace): StageKey {
  return AGENT_STAGE[trace.agent] ?? "verify";
}

function cited(ids: readonly string[], known: Map<string, Evidence>): Evidence[] {
  return ids.flatMap((id) => {
    const evidence = known.get(id);
    return evidence ? [evidence] : [];
  });
}
