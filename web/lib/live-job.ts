// The web's mirror of the backend's `Job.apply`: one reducer, so a job folded
// from a snapshot plus its frames is the job the server stored. The parity
// test replays every recorded run through it and compares to the server's own
// final document (web/tests/lib/live-job.test.ts).
import type {
  EventFrame,
  Finding,
  Job,
  ReasoningTrace,
  Stage,
  StageKey,
} from "./generated/argus";

export type ArgusEvent = EventFrame["event"];

const STAGE_ORDER: readonly StageKey[] = [
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

/** An event that does not fit the job's state. A server bug, never a user error. */
export class IllegalTransition extends Error {}

/** The derived fields, recomputed from what they summarise. */
function totals(job: Job): Pick<Job, "cost_usd" | "total_tokens" | "claims_total" | "claims_audited"> {
  return {
    cost_usd: round6(job.traces.reduce((sum, t) => sum + t.usage.cost_usd, 0)),
    total_tokens: job.traces.reduce((sum, t) => sum + t.usage.total_tokens, 0),
    claims_total: job.claims.length,
    claims_audited: job.findings.filter((f) => f.agent === "verifier").length,
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function traceIndex(job: Job, traceId: string): number {
  const i = job.traces.findIndex((t) => t.id === traceId);
  if (i === -1) throw new IllegalTransition(`no trace ${traceId}`);
  if (job.traces[i].completed_at !== null) {
    throw new IllegalTransition(`trace ${traceId} is closed`);
  }
  return i;
}

export function applyEvent(job: Job, event: ArgusEvent): Job {
  const next = apply(job, event);
  return { ...next, ...totals(next), version: job.version + 1 };
}

function apply(job: Job, event: ArgusEvent): Job {
  if (event.type === "claims_selected") {
    if (job.status !== "awaiting_review") {
      throw new IllegalTransition(`${event.type} on a job that is ${job.status}`);
    }
    const selected = new Set(event.claim_ids);
    const unknown = event.claim_ids.filter((id) => !job.claims.some((c) => c.id === id));
    if (unknown.length > 0) {
      throw new IllegalTransition(`not review candidates: ${unknown.join(", ")}`);
    }
    return {
      ...job,
      status: "running",
      claims: job.claims.filter((c) => selected.has(c.id)),
    };
  }
  if (job.status !== "running") {
    throw new IllegalTransition(`${event.type} on a job that is ${job.status}`);
  }
  switch (event.type) {
    case "stage_started": {
      if (job.stages.some((s) => s.key === event.key)) {
        throw new IllegalTransition(`stage ${event.key} started twice`);
      }
      const stages: Stage[] = [
        ...job.stages,
        {
          key: event.key,
          engine: event.engine,
          status: "running",
          summary: "",
          metrics: {},
          filtered_claims: [],
        },
      ];
      stages.sort((a, b) => STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key));
      return { ...job, stages };
    }
    case "stage_finished": {
      const i = job.stages.findIndex((s) => s.key === event.key);
      if (i === -1 || job.stages[i].status !== "running") {
        throw new IllegalTransition(`stage ${event.key} is not running`);
      }
      const stages = [...job.stages];
      stages[i] = {
        ...stages[i],
        status: "done",
        summary: event.summary,
        metrics: event.metrics,
        filtered_claims: event.filtered_claims,
      };
      return { ...job, stages };
    }
    case "review_ready":
      return { ...job, status: "awaiting_review", claims: event.claims };
    case "trace_opened": {
      if (job.traces.some((t) => t.id === event.trace.id)) {
        throw new IllegalTransition(`trace ${event.trace.id} opened twice`);
      }
      return { ...job, traces: [...job.traces, event.trace] };
    }
    case "step_recorded": {
      const i = traceIndex(job, event.trace_id);
      const traces = [...job.traces];
      traces[i] = { ...traces[i], steps: [...traces[i].steps, event.step] };
      return { ...job, traces };
    }
    case "trace_closed": {
      const i = traceIndex(job, event.trace_id);
      const traces: ReasoningTrace[] = [...job.traces];
      traces[i] = {
        ...traces[i],
        usage: event.usage,
        completed_at: event.completed_at,
      };
      return { ...job, traces };
    }
    case "finding_recorded": {
      const known = new Set(job.evidences.map((e) => e.id));
      const findings: Finding[] = [...job.findings];
      const i = findings.findIndex((f) => f.id === event.finding.id);
      if (i === -1) findings.push(event.finding);
      else findings[i] = event.finding;
      return {
        ...job,
        findings,
        evidences: [...job.evidences, ...event.evidences.filter((e) => !known.has(e.id))],
      };
    }
    case "report_written":
      return { ...job, audit_report_md: event.markdown };
    case "finished":
      return {
        ...job,
        status: event.status,
        failure: event.failure,
        completed_at: event.completed_at,
        stages: job.stages.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)),
      };
  }
}

/** The same job with nothing recorded on it yet: what a replay starts from. */
export function emptyJob(job: Job): Job {
  return {
    ...job,
    status: "running",
    failure: null,
    completed_at: null,
    version: 0,
    audit_report_md: null,
    claims: [],
    findings: [],
    traces: [],
    evidences: [],
    stages: [],
    cost_usd: 0,
    total_tokens: 0,
    claims_total: 0,
    claims_audited: 0,
  };
}

export function applyFrame(job: Job, frame: EventFrame): Job {
  return applyEvent(job, frame.event);
}

// --- Selectors ----------------------------------------------------------------

export function isTerminal(job: Job): boolean {
  return job.status === "done" || job.status === "failed";
}

export function stage(job: Job, key: StageKey): Stage | undefined {
  return job.stages.find((s) => s.key === key);
}

/** The traces still being written, newest last: what the live view shows. */
export function openTraces(job: Job): ReasoningTrace[] {
  return job.traces.filter((t) => t.completed_at === null);
}
