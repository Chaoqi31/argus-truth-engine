import { describe, expect, it } from "vitest";
import {
  getFindingAuditability,
  getJobAuditability,
} from "@/lib/auditability";
import type { Finding, Job } from "@/lib/types";

const finding: Finding = {
  id: "f1",
  job_id: "j1",
  claim_id: "c1",
  agent: "UnifiedVerifier",
  verdict: "fabricated",
  severity: "major",
  confidence: 0.94,
  summary: "The citation is fabricated.",
  evidence_ids: ["e1"],
  reasoning_trace_id: "t1",
  related_finding_ids: [],
  created_at: "2026-05-20T00:00:00Z",
  reasoning_chain: [
    {
      action: "Searched for the exact title.",
      observation: "No source found.",
      reasoning: "Exact-title misses support fabrication.",
    },
  ],
  coverage: [
    {
      claim_fragment: "Goldman report exists",
      relation: "refutes",
      evidence_ids: ["e1"],
      reason: "No matching issuer or publisher page exists.",
    },
  ],
  evidence_quality: [
    {
      evidence_id: "e1",
      role: "negative evidence",
      authority: 0.8,
      independence: 0.8,
      freshness: 0.8,
      directness: 0.8,
      rationale: "Exact-title search probes the cited artifact.",
    },
  ],
  skeptic_review: {
    status: "no_counterevidence",
    summary: "No credible alternate title was found.",
    recommended_verdict: null,
    counterevidence: [],
  },
  computation_check: {
    kind: "numeric",
    claimed_value: "$5 trillion",
    extracted_values: [
      { label: "closest estimate", value: "3.0", unit: "T USD", source_evidence_id: "e1" },
    ],
    formula: "3.0T != 5.0T",
    computed_value: "$3.0 trillion",
    tolerance: "none",
    judgment: "refutes",
    rationale: "The cited numeric claim is not supported.",
  },
};

const job: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: "2026-05-20T00:05:00Z",
  cost_usd: 1,
  total_tokens: 1000,
  audit_report_md: null,
  claims: [
    {
      id: "c1",
      text: "The report says AI infrastructure spend will exceed $5 trillion.",
      page: 1,
      span: [0, 64],
      type: "numerical-data",
      importance: "high",
      extracted_metadata: {},
    },
  ],
  findings: [finding],
  traces: [
    {
      id: "t1",
      job_id: "j1",
      claim_id: "c1",
      agent: "UnifiedVerifier",
      miromind_response_id: "resp_123",
      started_at: "2026-05-20T00:00:00Z",
      completed_at: "2026-05-20T00:04:00Z",
      total_tokens: 4200,
      reasoning_tokens: 900,
      num_search_queries: 2,
      final_verdict_step_id: null,
      steps: [
        {
          id: "s1",
          trace_id: "t1",
          sequence: 1,
          type: "web_search",
          summary: "Search exact title.",
          content: {},
          evidence_ids: ["e1"],
          parent_step_id: null,
          created_at: "2026-05-20T00:01:00Z",
        },
      ],
    },
  ],
  evidences: [
    {
      id: "e1",
      source_type: "web_page",
      url: "https://example.com/source",
      citation: "Source search",
      snippet: "No exact match.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:02:00Z",
      retrieved_by_step_id: "s1",
    },
  ],
};

describe("auditability", () => {
  it("marks all applicable controls present when a finding has full provenance", () => {
    const auditability = getFindingAuditability(job, finding);

    expect(auditability.presentCount).toBe(7);
    expect(auditability.requiredCount).toBe(7);
    expect(auditability.controls.map((control) => [control.id, control.status])).toEqual([
      ["trace", "present"],
      ["evidence", "present"],
      ["provenance", "present"],
      ["coverage", "present"],
      ["source_quality", "present"],
      ["skeptic", "present"],
      ["computation", "present"],
    ]);
    expect(auditability.controls[0]?.detail).toContain("resp_123");
  });

  it("distinguishes missing required controls from non-applicable controls", () => {
    const okFinding: Finding = {
      ...finding,
      id: "f_ok",
      verdict: "ok",
      severity: "minor",
      evidence_ids: [],
      reasoning_chain: [],
      coverage: [],
      evidence_quality: [],
      skeptic_review: null,
      computation_check: null,
    };
    const qualitativeJob: Job = {
      ...job,
      claims: [{ ...job.claims[0], id: "c_ok", type: "qualitative" }],
      findings: [{ ...okFinding, claim_id: "c_ok" }],
      traces: [],
      evidences: [],
    };

    const auditability = getFindingAuditability(qualitativeJob, qualitativeJob.findings[0]!);

    expect(auditability.requiredCount).toBe(5);
    expect(auditability.presentCount).toBe(0);
    expect(auditability.controls.find((c) => c.id === "skeptic")?.status).toBe("not_applicable");
    expect(auditability.controls.find((c) => c.id === "computation")?.status).toBe("not_applicable");
  });

  it("treats source controls as non-applicable for derived pipeline findings", () => {
    const derivedFinding: Finding = {
      ...finding,
      id: "f_derived",
      claim_id: "c_derived",
      agent: "Consistency",
      verdict: "unsupported-inference",
      severity: "major",
      evidence_ids: [],
      coverage: [],
      evidence_quality: [],
      skeptic_review: null,
      computation_check: null,
      reasoning_trace_id: "t_derived",
    };
    const derivedJob: Job = {
      ...job,
      claims: [
        {
          id: "c_derived",
          text: "The document draws a conclusion not supported by its verified claims.",
          page: 1,
          span: [0, 67],
          type: "qualitative",
          importance: "high",
          extracted_metadata: {},
        },
      ],
      findings: [derivedFinding],
      traces: [
        {
          ...job.traces[0]!,
          id: "t_derived",
          claim_id: "c_derived",
          agent: "Consistency",
          miromind_response_id: "deepseek:consistency",
        },
      ],
      evidences: [],
    };

    const auditability = getFindingAuditability(derivedJob, derivedFinding);

    expect(auditability.presentCount).toBe(1);
    expect(auditability.requiredCount).toBe(1);
    expect(auditability.controls.find((c) => c.id === "trace")?.label).toBe("Reasoning trace");
    expect(auditability.controls.find((c) => c.id === "evidence")?.status).toBe("not_applicable");
    expect(auditability.controls.find((c) => c.id === "provenance")?.status).toBe("not_applicable");
    expect(auditability.controls.find((c) => c.id === "coverage")?.status).toBe("not_applicable");
    expect(auditability.controls.find((c) => c.id === "source_quality")?.status).toBe("not_applicable");
    expect(auditability.controls.find((c) => c.id === "evidence")?.detail).toContain(
      "does not create new external-source evidence",
    );
  });

  it("aggregates controls across the job for an export-ready auditability summary", () => {
    const summary = getJobAuditability(job);

    expect(summary.findings).toBe(1);
    expect(summary.presentCount).toBe(7);
    expect(summary.requiredCount).toBe(7);
    expect(summary.fullyAuditableFindings).toBe(1);
    expect(summary.incompleteFindings).toBe(0);
    expect(summary.gapRows).toEqual([]);
    expect(summary.controls.find((c) => c.id === "provenance")).toMatchObject({
      label: "Evidence-to-step provenance",
      present: 1,
      required: 1,
      missing: 0,
    });
  });

  it("lists auditability gaps for incomplete verifier findings", () => {
    const incompleteFinding: Finding = {
      ...finding,
      id: "f_gap",
      claim_id: "c_gap",
      verdict: "ok",
      severity: "minor",
      confidence: 0.91,
      evidence_ids: [],
      reasoning_trace_id: "missing_trace",
      coverage: [],
      evidence_quality: [],
      skeptic_review: null,
      computation_check: null,
    };
    const mixedJob: Job = {
      ...job,
      claims: [
        job.claims[0]!,
        {
          id: "c_gap",
          text: "This qualitative control claim has no audit trail.",
          page: 1,
          span: [65, 112],
          type: "qualitative",
          importance: "medium",
          extracted_metadata: {},
        },
      ],
      findings: [finding, incompleteFinding],
    };

    const summary = getJobAuditability(mixedJob);

    expect(summary.findings).toBe(2);
    expect(summary.fullyAuditableFindings).toBe(1);
    expect(summary.incompleteFindings).toBe(1);
    expect(summary.gapRows).toEqual([
      expect.objectContaining({
        findingId: "f_gap",
        claimId: "c_gap",
        claimText: "This qualitative control claim has no audit trail.",
        verdict: "ok",
        severity: "minor",
        missingControlIds: ["trace", "evidence", "provenance", "coverage", "source_quality"],
        missingControlLabels: [
          "Reasoning trace",
          "Linked evidence",
          "Evidence-to-step provenance",
          "Claim coverage matrix",
          "Source-quality scoring",
        ],
      }),
    ]);
  });
});
