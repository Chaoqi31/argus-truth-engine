// Hand-mirrored from src/argus/models/domain.py. Update both when one changes.

export type ClaimType =
  | "citation"
  | "numerical-data"
  | "time-sensitive"
  | "cross-reference"
  | "qualitative";

export type Severity = "critical" | "major" | "minor";

export type FindingVerdict =
  | "ok"
  | "fabricated"
  | "partial-match"
  | "mismatch"
  | "misrepresented"
  | "stale"
  | "superseded"
  | "contradiction"
  | "uncertain";

export type EvidenceSourceType =
  | "crossref"
  | "arxiv"
  | "ssrn"
  | "sec_edgar"
  | "fred"
  | "worldbank"
  | "imf"
  | "wikipedia"
  | "company_filing"
  | "web_page"
  | "internal_doc";

export type StepType =
  | "thinking"
  | "web_search"
  | "fetch_url_content"
  | "execute_python"
  | "execute_command"
  | "tool_call"
  | "message";

export interface Claim {
  id: string;
  text: string;
  page: number;
  span: [number, number];
  type: ClaimType;
  importance: "high" | "medium" | "low";
  extracted_metadata: Record<string, unknown>;
}

export interface Evidence {
  id: string;
  source_type: EvidenceSourceType;
  url: string | null;
  citation: string;
  snippet: string;
  full_content_ref: string | null;
  retrieved_at: string; // ISO datetime
  retrieved_by_step_id: string;
}

export interface Step {
  id: string;
  trace_id: string;
  sequence: number;
  type: StepType;
  summary: string;
  content: Record<string, unknown>;
  evidence_ids: string[];
  parent_step_id: string | null;
  created_at: string;
}

export interface ReasoningTrace {
  id: string;
  job_id: string;
  claim_id: string;
  agent: string;
  miromind_response_id: string;
  started_at: string;
  completed_at: string | null;
  total_tokens: number;
  reasoning_tokens: number;
  num_search_queries: number;
  final_verdict_step_id: string | null;
  steps: Step[];
}

export interface Finding {
  id: string;
  job_id: string;
  claim_id: string;
  agent: string;
  verdict: FindingVerdict;
  severity: Severity;
  confidence: number;
  summary: string;
  evidence_ids: string[];
  reasoning_trace_id: string;
  related_finding_ids: string[];
  created_at: string;
}

export type JobStatus =
  | "queued"
  | "parsing"
  | "planning"
  | "verifying"
  | "reporting"
  | "done"
  | "failed";

export interface Job {
  id: string;
  pdf_path: string;
  status: JobStatus;
  created_at: string;
  completed_at: string | null;
  cost_usd: number;
  total_tokens: number;
  audit_report_md: string | null;        // NEW
  claims: Claim[];
  findings: Finding[];
  traces: ReasoningTrace[];
  evidences: Evidence[];
}

export function isCitationClaim(c: Claim): boolean {
  return c.type === "citation";
}
