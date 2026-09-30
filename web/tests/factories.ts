// Complete domain values for tests. Pass only the fields a test is about.
import type {
  Claim,
  Evidence,
  Finding,
  Job,
  ReasoningTrace,
  Stage,
  Step,
} from "@/lib/types";

const T0 = "2026-01-01T00:00:00Z";

export function makeClaim(fields: Partial<Claim> = {}): Claim {
  return {
    id: "c1",
    text: "",
    page: 1,
    span: [0, 0],
    type: "qualitative",
    importance: "medium",
    extracted_metadata: {},
    parent_claim_id: null,
    context: "",
    ...fields,
  };
}

export function makeEvidence(fields: Partial<Evidence> = {}): Evidence {
  return {
    id: "e1",
    source_type: "web_page",
    url: null,
    citation: "",
    snippet: "",
    retrieved_at: T0,
    retrieved_by_step_id: "s1",
    ...fields,
  };
}

export function makeFinding(fields: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    claim_id: "c1",
    agent: "verifier",
    verdict: "ok",
    severity: "minor",
    confidence: 0.9,
    confidence_breakdown: null,
    summary: "",
    why_wrong: null,
    correct_information: null,
    reasoning_chain: [],
    evidence_quality: [],
    coverage: [],
    skeptic_review: null,
    computation_check: null,
    evidence_ids: [],
    reasoning_trace_id: "t1",
    created_at: T0,
    from_cache: false,
    flags: [],
    ...fields,
  };
}

export function makeStep(fields: Partial<Step> = {}): Step {
  return {
    id: "s1",
    type: "thinking",
    summary: "",
    content: {},
    created_at: T0,
    ...fields,
  };
}

export function makeTrace(fields: Partial<ReasoningTrace> = {}): ReasoningTrace {
  return {
    id: "t1",
    claim_id: "c1",
    agent: "verifier",
    engine: "miromind",
    started_at: T0,
    completed_at: null,
    usage: {
      response_ids: ["resp_1"],
      total_tokens: 0,
      reasoning_tokens: 0,
      num_search_queries: 0,
      cost_usd: 0,
    },
    steps: [],
    ...fields,
  };
}

export function makeStage(fields: Partial<Stage> = {}): Stage {
  return {
    key: "parse",
    engine: "deterministic",
    status: "done",
    summary: "",
    metrics: {},
    filtered_claims: [],
    ...fields,
  };
}

export function makeJob(fields: Partial<Job> = {}): Job {
  return {
    id: "j1",
    scenario_label: null,
    persona: null,
    pdf_path: "",
    input_text: null,
    input_mode: "pdf",
    content_domain: "general",
    auto_review: false,
    status: "done",
    failure: null,
    created_at: T0,
    completed_at: null,
    version: 0,
    cost_usd: 0,
    total_tokens: 0,
    audit_report_md: null,
    claims_total: 0,
    claims_audited: 0,
    claims: [],
    findings: [],
    traces: [],
    evidences: [],
    stages: [],
    benchmark: null,
    ...fields,
  };
}
