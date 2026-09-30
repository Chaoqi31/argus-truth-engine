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
    full_content_ref: null,
    retrieved_at: T0,
    retrieved_by_step_id: "s1",
    ...fields,
  };
}

export function makeFinding(fields: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    job_id: "j1",
    claim_id: "c1",
    agent: "UnifiedVerifier",
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
    related_finding_ids: [],
    created_at: T0,
    from_cache: false,
    flags: [],
    ...fields,
  };
}

export function makeStep(fields: Partial<Step> = {}): Step {
  return {
    id: "s1",
    trace_id: "t1",
    sequence: 0,
    type: "thinking",
    summary: "",
    content: {},
    evidence_ids: [],
    parent_step_id: null,
    created_at: T0,
    ...fields,
  };
}

export function makeTrace(fields: Partial<ReasoningTrace> = {}): ReasoningTrace {
  return {
    id: "t1",
    job_id: "j1",
    claim_id: "c1",
    agent: "UnifiedVerifier",
    miromind_response_id: "resp_1",
    started_at: T0,
    completed_at: null,
    total_tokens: 0,
    reasoning_tokens: 0,
    num_search_queries: 0,
    final_verdict_step_id: null,
    steps: [],
    ...fields,
  };
}

export function makeStage(fields: Partial<Stage> = {}): Stage {
  return {
    key: "parse",
    name: "Parse",
    engine: "deterministic",
    summary: "",
    metrics: {},
    strategy: null,
    filtered_claims: null,
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
