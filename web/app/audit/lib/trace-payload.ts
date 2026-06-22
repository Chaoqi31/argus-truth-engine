import type { Finding, LiveFinding, LiveHeartbeat, Step, StepType } from "@/lib/types";

const STEP_TYPES = new Set<StepType>([
  "thinking",
  "web_search",
  "fetch_url_content",
  "execute_python",
  "execute_command",
  "tool_call",
  "message",
]);

function isStepType(value: unknown): value is StepType {
  return typeof value === "string" && STEP_TYPES.has(value as StepType);
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

let syntheticStepCounter = 0;

function nextSyntheticStepId(prefix: string, key: string): string {
  syntheticStepCounter += 1;
  return `${prefix}-${key}-${syntheticStepCounter}`;
}

export interface StageEventPayload {
  status: "started" | "finished";
  key: string;
  name: string;
  engine: string;
  summary: string;
}

export interface ClaimEventPayload {
  status: "started" | "finished";
  claim_id: string;
  text: string;
  index: number;
  total: number;
}

export function stageMarkerStep(
  key: string,
  name: string,
  engine: string,
  summary: string,
  sequence: number,
): Step {
  return {
    id: nextSyntheticStepId("stage", key),
    trace_id: "__pipeline",
    sequence,
    type: "message",
    summary,
    content: { __stage: { key, name, engine, summary } },
    evidence_ids: [],
    parent_step_id: null,
    created_at: new Date().toISOString(),
  };
}

export function stageFromPayload(payload: Record<string, unknown>): StageEventPayload | null {
  if (
    (payload.status !== "started" && payload.status !== "finished") ||
    typeof payload.key !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.engine !== "string"
  ) {
    return null;
  }
  return {
    status: payload.status,
    key: payload.key,
    name: payload.name,
    engine: payload.engine,
    summary: typeof payload.summary === "string" ? payload.summary : payload.name,
  };
}

export function claimFromPayload(payload: Record<string, unknown>): ClaimEventPayload | null {
  if (
    (payload.status !== "started" && payload.status !== "finished") ||
    typeof payload.claim_id !== "string" ||
    typeof payload.text !== "string" ||
    typeof payload.index !== "number" ||
    typeof payload.total !== "number"
  ) {
    return null;
  }
  return {
    status: payload.status,
    claim_id: payload.claim_id,
    text: payload.text,
    index: payload.index,
    total: payload.total,
  };
}

export function claimMarkerStep(claim: ClaimEventPayload, sequence: number): Step {
  return {
    id: nextSyntheticStepId("claim", claim.claim_id),
    trace_id: "__pipeline",
    sequence,
    type: "message",
    summary: claim.text,
    content: {
      claim_id: claim.claim_id,
      __claim: { index: claim.index, total: claim.total, text: claim.text },
    },
    evidence_ids: [],
    parent_step_id: null,
    created_at: new Date().toISOString(),
  };
}

export function heartbeatFromPayload(payload: Record<string, unknown>): LiveHeartbeat | null {
  if (
    typeof payload.stage !== "string" ||
    typeof payload.agent !== "string" ||
    typeof payload.elapsed_s !== "number" ||
    typeof payload.message !== "string"
  ) {
    return null;
  }
  return {
    stage: payload.stage,
    agent: payload.agent,
    claim_id: typeof payload.claim_id === "string" ? payload.claim_id : null,
    elapsed_s: payload.elapsed_s,
    message: payload.message,
  };
}

export function stepFromPayload(payload: Record<string, unknown>): Step | null {
  const native = recordFrom(payload.step);
  if (native) {
    const traceId =
      typeof native.trace_id === "string"
        ? native.trace_id
        : typeof payload.trace_id === "string"
          ? payload.trace_id
          : null;
    if (!traceId) return null;

    const baseContent = recordFrom(native.content) ?? {};
    const content = {
      ...baseContent,
      agent: payload.agent,
      claim_id: payload.claim_id,
    };

    return {
      id:
        typeof native.id === "string"
          ? native.id
          : `live_${traceId}_${Math.random().toString(36).slice(2, 8)}`,
      trace_id: traceId,
      sequence:
        typeof native.sequence === "number"
          ? native.sequence
          : Number(payload.sequence ?? 0),
      type: isStepType(native.type) ? native.type : "message",
      summary:
        typeof native.summary === "string"
          ? native.summary
          : String(payload.summary ?? payload.agent ?? "agent"),
      content,
      evidence_ids: Array.isArray(native.evidence_ids)
        ? native.evidence_ids.filter((id): id is string => typeof id === "string")
        : [],
      parent_step_id: typeof native.parent_step_id === "string" ? native.parent_step_id : null,
      created_at: typeof native.created_at === "string" ? native.created_at : new Date().toISOString(),
    };
  }

  if (typeof payload.trace_id !== "string") return null;
  return {
    id: `live_${payload.trace_id}_${Math.random().toString(36).slice(2, 8)}`,
    trace_id: String(payload.trace_id),
    sequence: Number(payload.total_tokens ?? 0),
    type: "message",
    summary: `${String(payload.agent ?? "agent")} — ${String(payload.claim_id ?? "")}`.trim(),
    content: payload,
    evidence_ids: [],
    parent_step_id: null,
    created_at: new Date().toISOString(),
  };
}

export function findingFromPayload(payload: Record<string, unknown>): LiveFinding | null {
  if (
    typeof payload.finding_id !== "string" ||
    typeof payload.claim_id !== "string" ||
    typeof payload.agent !== "string" ||
    typeof payload.verdict !== "string" ||
    typeof payload.severity !== "string" ||
    typeof payload.summary !== "string"
  ) {
    return null;
  }
  return {
    id: payload.finding_id,
    claim_id: payload.claim_id,
    agent: payload.agent,
    verdict: payload.verdict as LiveFinding["verdict"],
    severity: payload.severity as LiveFinding["severity"],
    summary: payload.summary,
  };
}

export function toLiveFinding(f: Finding): LiveFinding {
  return {
    id: f.id,
    claim_id: f.claim_id,
    agent: f.agent,
    verdict: f.verdict,
    severity: f.severity,
    summary: f.summary,
  };
}
