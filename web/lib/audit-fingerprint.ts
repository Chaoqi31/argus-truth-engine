import type { Job } from "@/lib/types";

export interface AuditFingerprint {
  algorithm: "fnv1a64";
  fingerprint: string;
  included: {
    claims: number;
    findings: number;
    traces: number;
    steps: number;
    evidences: number;
    stages: number;
  };
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const UINT64_MASK = BigInt("0xffffffffffffffff");

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(input).sort()) {
      const item = input[key];
      if (item !== undefined) output[key] = normalize(item);
    }
    return output;
  }
  return null;
}

function fnv1a64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

function fingerprintPayload(job: Job) {
  return {
    job: {
      content_domain: job.content_domain ?? "general",
      input_mode: job.input_mode ?? "pdf",
      status: job.status,
      claims_total: job.claims_total ?? job.claims.length,
      claims_audited: job.claims_audited ?? null,
      cost_usd: job.cost_usd,
      total_tokens: job.total_tokens,
    },
    claims: job.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      page: claim.page,
      span: claim.span,
      type: claim.type,
      importance: claim.importance,
      parent_claim_id: claim.parent_claim_id ?? null,
      extracted_metadata: claim.extracted_metadata,
    })),
    findings: job.findings.map((finding) => ({
      id: finding.id,
      claim_id: finding.claim_id,
      agent: finding.agent,
      verdict: finding.verdict,
      severity: finding.severity,
      confidence: finding.confidence,
      summary: finding.summary,
      why_wrong: finding.why_wrong ?? null,
      correct_information: finding.correct_information ?? null,
      reasoning_chain: finding.reasoning_chain ?? [],
      coverage: finding.coverage ?? [],
      evidence_quality: finding.evidence_quality ?? [],
      skeptic_review: finding.skeptic_review ?? null,
      computation_check: finding.computation_check ?? null,
      evidence_ids: finding.evidence_ids,
      reasoning_trace_id: finding.reasoning_trace_id,
      related_finding_ids: finding.related_finding_ids,
      flags: finding.flags ?? [],
    })),
    traces: job.traces.map((trace) => ({
      id: trace.id,
      claim_id: trace.claim_id,
      agent: trace.agent,
      miromind_response_id: trace.miromind_response_id,
      total_tokens: trace.total_tokens,
      reasoning_tokens: trace.reasoning_tokens,
      num_search_queries: trace.num_search_queries,
      final_verdict_step_id: trace.final_verdict_step_id,
      steps: trace.steps.map((step) => ({
        id: step.id,
        sequence: step.sequence,
        type: step.type,
        summary: step.summary,
        content: step.content,
        evidence_ids: step.evidence_ids,
        parent_step_id: step.parent_step_id,
      })),
    })),
    evidences: job.evidences.map((evidence) => ({
      id: evidence.id,
      source_type: evidence.source_type,
      url: evidence.url,
      citation: evidence.citation,
      snippet: evidence.snippet,
      full_content_ref: evidence.full_content_ref,
      retrieved_by_step_id: evidence.retrieved_by_step_id,
    })),
    stages: (job.stages ?? []).map((stage) => ({
      key: stage.key,
      name: stage.name,
      engine: stage.engine,
      summary: stage.summary,
      metrics: stage.metrics,
      strategy: stage.strategy ?? null,
      filtered_claims: stage.filtered_claims ?? [],
    })),
  };
}

export function getAuditFingerprint(job: Job): AuditFingerprint {
  const payload = fingerprintPayload(job);
  const canonical = stableStringify(payload);
  const steps = job.traces.reduce((sum, trace) => sum + trace.steps.length, 0);
  const digest = fnv1a64(canonical);

  return {
    algorithm: "fnv1a64",
    fingerprint: `fnv1a64:${digest}`,
    included: {
      claims: job.claims.length,
      findings: job.findings.length,
      traces: job.traces.length,
      steps,
      evidences: job.evidences.length,
      stages: job.stages?.length ?? 0,
    },
  };
}
