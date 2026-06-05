import { describe, expect, it } from "vitest";
import { buildAuditPackMarkdown } from "@/lib/audit-pack";
import type { FindingReview, Job } from "@/lib/types";

const job: Job = {
  id: "j1",
  pdf_path: "x.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: "2026-05-20T00:10:00Z",
  cost_usd: 0,
  total_tokens: 1000,
  claims_total: 1,
  claims_audited: 1,
  audit_report_md: null,
  claims: [
    {
      id: "c1",
      text: "The memo cites a Goldman Silicon Supercycle report.",
      page: 1,
      span: [0, 54],
      type: "citation",
      importance: "high",
      extracted_metadata: {},
    },
  ],
  findings: [
    {
      id: "f1",
      job_id: "j1",
      claim_id: "c1",
      agent: "UnifiedVerifier",
      verdict: "fabricated",
      severity: "major",
      confidence: 0.94,
      summary: "No matching Goldman report was found.",
      why_wrong: "The named report does not appear in public source records.",
      reasoning_chain: [
        {
          action: "Searched for the exact report title.",
          observation: "No matching report appeared.",
          reasoning: "The absence of a source record supports a fabricated verdict.",
        },
      ],
      evidence_ids: ["e1"],
      reasoning_trace_id: "t1",
      related_finding_ids: [],
      created_at: "2026-05-20T00:00:00Z",
    },
  ],
  traces: [],
  evidences: [
    {
      id: "e1",
      source_type: "web_page",
      url: "https://example.com/search",
      citation: "Search results",
      snippet: "No exact title match.",
      full_content_ref: null,
      retrieved_at: "2026-05-20T00:00:00Z",
      retrieved_by_step_id: "s1",
    },
  ],
};

describe("buildAuditPackMarkdown", () => {
  it("includes coverage, reviewer decisions, reasoning, and evidence", () => {
    const reviews: Record<string, FindingReview> = {
      f1: {
        status: "disputed",
        note: "Reviewer wants a second source before final sign-off.",
        updated_at: "2026-05-20T00:20:00Z",
      },
    };

    const markdown = buildAuditPackMarkdown(job, reviews);

    expect(markdown).toContain("# Argus Audit Pack");
    expect(markdown).toContain("- Checked claims: 1/1");
    expect(markdown).toContain("Review decision: disputed");
    expect(markdown).toContain("Reviewer wants a second source");
    expect(markdown).toContain("Searched for the exact report title");
    expect(markdown).toContain("Search results");
    expect(markdown).toContain("https://example.com/search");
  });

  it("summarizes auditability controls so reviewers can see provenance gaps", () => {
    const controlledJob: Job = {
      ...job,
      findings: [
        {
          ...job.findings[0],
          coverage: [
            {
              claim_fragment: "Goldman report exists",
              relation: "refutes",
              evidence_ids: ["e1"],
              reason: "Exact-title source search found no match.",
            },
          ],
          evidence_quality: [
            {
              evidence_id: "e1",
              role: "negative evidence",
              authority: 0.82,
              independence: 0.76,
              freshness: 0.91,
              directness: 0.88,
              rationale: "The source directly probes the cited title.",
            },
          ],
          skeptic_review: {
            status: "no_counterevidence",
            summary: "No credible alternate title was found.",
            recommended_verdict: null,
            counterevidence: [],
          },
        },
      ],
      traces: [
        {
          id: "t1",
          job_id: "j1",
          claim_id: "c1",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_control",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 100,
          reasoning_tokens: 20,
          num_search_queries: 1,
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
    };

    const markdown = buildAuditPackMarkdown(controlledJob, {});

    expect(markdown).toContain("## Auditability Controls");
    expect(markdown).toContain("- Controls present: 6/6");
    expect(markdown).toContain("| MiroMind trace | 1/1 | 0 |");
    expect(markdown).toContain("| Evidence-to-step provenance | 1/1 | 0 |");
    expect(markdown).toContain("| Computation replay | n/a | n/a |");
  });

  it("exports an auditability gap register for incomplete finding evidence", () => {
    const gapJob: Job = {
      ...job,
      claims_total: 2,
      claims_audited: 2,
      claims: [
        job.claims[0],
        {
          ...job.claims[0],
          id: "c_gap",
          text: "A second claim without a saved audit trail.",
          type: "qualitative",
        },
      ],
      findings: [
        {
          ...job.findings[0],
          coverage: [
            {
              claim_fragment: "Goldman report exists",
              relation: "refutes",
              evidence_ids: ["e1"],
              reason: "Exact-title source search found no match.",
            },
          ],
          evidence_quality: [
            {
              evidence_id: "e1",
              role: "negative evidence",
              authority: 0.82,
              independence: 0.76,
              freshness: 0.91,
              directness: 0.88,
              rationale: "The source directly probes the cited title.",
            },
          ],
          skeptic_review: {
            status: "no_counterevidence",
            summary: "No credible alternate title was found.",
            recommended_verdict: null,
            counterevidence: [],
          },
        },
        {
          ...job.findings[0],
          id: "f_gap",
          claim_id: "c_gap",
          verdict: "ok",
          severity: "minor",
          summary: "No structured trail was persisted for this control finding.",
          evidence_ids: [],
          reasoning_trace_id: "missing_trace",
          coverage: [],
          evidence_quality: [],
          skeptic_review: null,
        },
      ],
      traces: [
        {
          id: "t1",
          job_id: "j1",
          claim_id: "c1",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_control",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 100,
          reasoning_tokens: 20,
          num_search_queries: 1,
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
    };

    const markdown = buildAuditPackMarkdown(gapJob, {});

    expect(markdown).toContain("## Auditability Gap Register");
    expect(markdown).toContain("- Fully audit-ready findings: 1/2");
    expect(markdown).toContain("| f_gap | ok | A second claim without a saved audit trail. | MiroMind trace; Linked evidence; Evidence-to-step provenance; Claim coverage matrix; Source-quality scoring |");
  });

  it("exports execution controls that demonstrate the runtime architecture", () => {
    const executionJob: Job = {
      ...job,
      claims_total: 2,
      claims_audited: 2,
      claims: [
        ...job.claims,
        {
          ...job.claims[0],
          id: "c2",
          text: "Second claim.",
        },
      ],
      findings: [
        {
          ...job.findings[0],
          skeptic_review: {
            status: "no_counterevidence",
            summary: "No counterevidence found.",
            recommended_verdict: null,
            counterevidence: [],
          },
        },
      ],
      stages: [
        {
          key: "review_gate",
          name: "Review gate",
          engine: "deterministic",
          summary: "2 claims selected",
          metrics: { n_verifying: 2 },
        },
        {
          key: "verify",
          name: "Verify",
          engine: "miromind",
          summary: "Deep-researched 2 claims",
          metrics: { n_claims: 2 },
        },
        {
          key: "skeptic",
          name: "Skeptic challenge",
          engine: "miromind",
          summary: "Challenged 1 high-risk finding",
          metrics: { n_reviewed: 1 },
        },
      ],
      traces: [
        {
          id: "t1",
          job_id: "j1",
          claim_id: "c1",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_1",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 100,
          reasoning_tokens: 20,
          num_search_queries: 1,
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
        {
          id: "t2",
          job_id: "j1",
          claim_id: "c2",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_2",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 100,
          reasoning_tokens: 20,
          num_search_queries: 1,
          final_verdict_step_id: null,
          steps: [
            {
              id: "s2",
              trace_id: "t2",
              sequence: 1,
              type: "web_search",
              summary: "Search source.",
              content: {},
              evidence_ids: [],
              parent_step_id: null,
              created_at: "2026-05-20T00:01:00Z",
            },
          ],
        },
      ],
    };

    const markdown = buildAuditPackMarkdown(executionJob, {});

    expect(markdown).toContain("## Execution Controls");
    expect(markdown).toContain("- Controls present: 6/6");
    expect(markdown).toContain("| Background responses | present | 2 response ids");
    expect(markdown).toContain("| Parallel verifier fan-out | present | 2 verifier traces");
    expect(markdown).toContain("| Budget guard | present | $0.00 spent · 2/2 audited |");
  });

  it("exports a technical implementation proof table for hackathon judging", () => {
    const technicalJob: Job = {
      ...job,
      cost_usd: 2.5,
      claims_total: 2,
      claims_audited: 2,
      claims: [
        ...job.claims,
        {
          ...job.claims[0],
          id: "c2",
          text: "Second claim.",
        },
      ],
      findings: [
        {
          ...job.findings[0],
          coverage: [
            {
              claim_fragment: "Goldman report exists",
              relation: "refutes",
              evidence_ids: ["e1"],
              reason: "Exact-title search found no issuer page.",
            },
          ],
          evidence_quality: [
            {
              evidence_id: "e1",
              role: "negative evidence",
              authority: 0.82,
              independence: 0.77,
              freshness: 0.91,
              directness: 0.88,
              rationale: "The search directly probes the cited artifact.",
            },
          ],
          skeptic_review: {
            status: "no_counterevidence",
            summary: "No counterevidence found.",
            recommended_verdict: null,
            counterevidence: [],
          },
        },
        {
          ...job.findings[0],
          id: "f2",
          claim_id: "c2",
          verdict: "ok",
          severity: "minor",
          confidence: 0.96,
          summary: "Control claim verified.",
          why_wrong: null,
          coverage: [],
          evidence_quality: [],
          skeptic_review: null,
          evidence_ids: [],
          reasoning_trace_id: "t2",
          related_finding_ids: [],
        },
      ],
      benchmark: {
        name: "planted benchmark",
        expected_claims: [
          { claim_id: "c1", verdict: "fabricated", rationale: "Planted fake citation." },
          { claim_id: "c2", verdict: "ok", rationale: "Control claim." },
        ],
      },
      stages: [
        {
          key: "planner",
          name: "Planner",
          engine: "deepseek",
          summary: "Extracted candidate claims.",
          metrics: { n_claims: 2 },
        },
        {
          key: "review_gate",
          name: "Review gate",
          engine: "deterministic",
          summary: "2 claims selected.",
          metrics: { n_verifying: 2 },
        },
        {
          key: "verify",
          name: "Verify",
          engine: "miromind",
          summary: "Deep-researched 2 claims.",
          metrics: { n_claims: 2 },
        },
        {
          key: "skeptic",
          name: "Skeptic challenge",
          engine: "miromind",
          summary: "Challenged high-risk findings.",
          metrics: { n_reviewed: 1 },
        },
        {
          key: "confidence",
          name: "Confidence",
          engine: "deterministic",
          summary: "Scored findings.",
          metrics: { n_scored: 2 },
        },
      ],
      traces: [
        {
          id: "t1",
          job_id: "j1",
          claim_id: "c1",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_1",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 100,
          reasoning_tokens: 20,
          num_search_queries: 1,
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
        {
          id: "t2",
          job_id: "j1",
          claim_id: "c2",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_2",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 100,
          reasoning_tokens: 20,
          num_search_queries: 1,
          final_verdict_step_id: null,
          steps: [
            {
              id: "s2",
              trace_id: "t2",
              sequence: 1,
              type: "web_search",
              summary: "Search source.",
              content: {},
              evidence_ids: [],
              parent_step_id: null,
              created_at: "2026-05-20T00:01:00Z",
            },
          ],
        },
      ],
    };

    const markdown = buildAuditPackMarkdown(technicalJob, {});

    expect(markdown).toContain("## Technical Implementation Proof");
    expect(markdown).toContain("- Proof points present: 10/10");
    expect(markdown).toContain("| LangGraph multi-stage graph | present | 5 persisted stages");
    expect(markdown).toContain("| MiroMind deep research | present | 2 response ids");
    expect(markdown).toContain("| Independent skeptic challenge | present | 1 finding independently challenged");
    expect(markdown).toContain("| Stable audit fingerprint | present | fnv1a64:");
    expect(markdown).toContain("| Ground-truth benchmark eval | present | 2/2 exact verifier matches");
    expect(markdown).toContain("## Judge Proof Strip");
    expect(markdown).toContain("| Architecture | present | 5-stage graph with review gate + verifier fan-out |");
    expect(markdown).toContain("| Native trace | present | 2 response ids");
    expect(markdown).toContain("| Benchmark | present | 2/2 exact matches");
    expect(markdown).toContain("| Skeptic | present | 1 challenged");
    expect(markdown).toContain("| Fingerprint | present | fnv1a64:");
    expect(markdown).toContain("## Audit Fingerprint");
    expect(markdown).toMatch(/- Fingerprint: fnv1a64:[0-9a-f]{16}/);
    expect(markdown).toContain("- Included records: claims 2; findings 2; traces 2; steps 2; evidences 1; stages 5");
    expect(markdown).toContain("## Benchmark Evaluation");
    expect(markdown).toContain("- Benchmark: planted benchmark");
    expect(markdown).toContain("- Exact verifier matches: 2/2");
    expect(markdown).toContain("- Issue recall: 100%");
    expect(markdown).toContain("| c1 | fabricated | fabricated | yes | Planted fake citation. |");
  });

  it("states the content domain used to guide verification", () => {
    const financeJob = { ...job, content_domain: "finance" } as Job & {
      content_domain: "finance";
    };

    const markdown = buildAuditPackMarkdown(financeJob, {});

    expect(markdown).toContain("- Content domain: finance");
  });

  it("summarizes reviewer decisions, spend, tokens, and tool use", () => {
    const governanceJob: Job = {
      ...job,
      cost_usd: 2.5,
      total_tokens: 10000,
      claims_total: 4,
      claims_audited: 4,
      claims: [
        ...job.claims,
        { ...job.claims[0], id: "c2", text: "Second claim." },
        { ...job.claims[0], id: "c3", text: "Third claim." },
        { ...job.claims[0], id: "c4", text: "Fourth claim." },
      ],
      findings: [
        job.findings[0],
        { ...job.findings[0], id: "f2", claim_id: "c2", verdict: "ok", severity: "minor" },
        { ...job.findings[0], id: "f3", claim_id: "c3", verdict: "uncertain", severity: "minor" },
        { ...job.findings[0], id: "f4", claim_id: "c4", verdict: "mismatch", severity: "major" },
      ],
      traces: [
        {
          id: "t1",
          job_id: "j1",
          claim_id: "c1",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_summary",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 4200,
          reasoning_tokens: 900,
          num_search_queries: 0,
          final_verdict_step_id: null,
          steps: [
            {
              id: "s1",
              trace_id: "t1",
              sequence: 1,
              type: "web_search",
              summary: "Search one.",
              content: {},
              evidence_ids: [],
              parent_step_id: null,
              created_at: "2026-05-20T00:01:00Z",
            },
            {
              id: "s2",
              trace_id: "t1",
              sequence: 2,
              type: "web_search",
              summary: "Search two.",
              content: {},
              evidence_ids: [],
              parent_step_id: null,
              created_at: "2026-05-20T00:02:00Z",
            },
            {
              id: "s3",
              trace_id: "t1",
              sequence: 3,
              type: "fetch_url_content",
              summary: "Fetch source.",
              content: {},
              evidence_ids: ["e1"],
              parent_step_id: "s2",
              created_at: "2026-05-20T00:03:00Z",
            },
            {
              id: "s4",
              trace_id: "t1",
              sequence: 4,
              type: "execute_python",
              summary: "Check calculation.",
              content: {},
              evidence_ids: [],
              parent_step_id: "s3",
              created_at: "2026-05-20T00:04:00Z",
            },
          ],
        },
      ],
    };
    const reviews: Record<string, FindingReview> = {
      f1: { status: "accepted", note: "", updated_at: "2026-05-20T00:20:00Z" },
      f2: { status: "disputed", note: "", updated_at: "2026-05-20T00:20:00Z" },
      f3: { status: "needs-recheck", note: "", updated_at: "2026-05-20T00:20:00Z" },
    };

    const markdown = buildAuditPackMarkdown(governanceJob, reviews);

    expect(markdown).toContain("- Review decisions: open: 1; accepted: 1; disputed: 1; needs-recheck: 1; resolved: 0");
    expect(markdown).toContain("- Estimated cost: $2.50");
    expect(markdown).toContain("- Tokens: 10,000");
    expect(markdown).toContain("- Tool use: 4 steps; 2 searches; 1 fetch; 1 code step");
  });

  it("orders findings by review priority in the exported audit pack", () => {
    const okFinding = {
      ...job.findings[0],
      id: "f_ok",
      claim_id: "c_ok",
      verdict: "ok" as const,
      severity: "minor" as const,
      confidence: 0.99,
      summary: "This claim is accurate.",
      why_wrong: null,
      evidence_ids: [],
    };
    const highRiskFinding = {
      ...job.findings[0],
      id: "f_bad",
      claim_id: "c_bad",
      verdict: "fabricated" as const,
      severity: "major" as const,
      confidence: 0.91,
      summary: "The citation is fabricated.",
      evidence_ids: ["e1"],
    };
    const unorderedJob: Job = {
      ...job,
      claims: [
        ...job.claims,
        {
          ...job.claims[0],
          id: "c_ok",
          text: "NVIDIA was founded in 1993.",
        },
        {
          ...job.claims[0],
          id: "c_bad",
          text: "The memo cites a fabricated Goldman report.",
        },
      ],
      findings: [okFinding, highRiskFinding],
    };

    const markdown = buildAuditPackMarkdown(unorderedJob, {});
    const register = markdown.slice(
      markdown.indexOf("## Finding Register"),
      markdown.indexOf("## Claim-Level Findings"),
    );
    const claimLevel = markdown.slice(
      markdown.indexOf("## Claim-Level Findings"),
      markdown.indexOf("## Evidence Appendix"),
    );

    expect(register.indexOf("| fabricated |")).toBeLessThan(register.indexOf("| ok |"));
    expect(claimLevel.indexOf("The memo cites a fabricated Goldman report")).toBeLessThan(
      claimLevel.indexOf("NVIDIA was founded in 1993"),
    );
  });

  it("includes a transparent pipeline and trace inventory", () => {
    const transparentJob: Job = {
      ...job,
      stages: [
        {
          key: "planner",
          name: "Planner",
          engine: "deepseek",
          summary: "Extracted 1 candidate claim.",
          metrics: { n_claims: 1 },
          strategy: "Prioritise citation and numerical claims.",
        },
        {
          key: "verify",
          name: "Verify",
          engine: "miromind",
          summary: "Verified the selected claim with web search.",
          metrics: { claims: 1, searches: 3 },
        },
      ],
      traces: [
        {
          id: "t1",
          job_id: "j1",
          claim_id: "c1",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_123",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 4200,
          reasoning_tokens: 900,
          num_search_queries: 3,
          final_verdict_step_id: "s2",
          steps: [
            {
              id: "s1",
              trace_id: "t1",
              sequence: 1,
              type: "web_search",
              summary: "Searched exact report title.",
              content: {},
              evidence_ids: [],
              parent_step_id: null,
              created_at: "2026-05-20T00:01:00Z",
            },
            {
              id: "s2",
              trace_id: "t1",
              sequence: 2,
              type: "message",
              summary: "Concluded the citation was fabricated.",
              content: {},
              evidence_ids: ["e1"],
              parent_step_id: "s1",
              created_at: "2026-05-20T00:02:00Z",
            },
          ],
        },
      ],
    };

    const markdown = buildAuditPackMarkdown(transparentJob, {});

    expect(markdown).toContain("## Reasoning Transparency");
    expect(markdown).toContain("| Planner | deepseek | Extracted 1 candidate claim. | n_claims: 1 |");
    expect(markdown).toContain("Prioritise citation and numerical claims.");
    expect(markdown).toContain("| Verify | miromind | Verified the selected claim with web search. | claims: 1; searches: 3 |");
    expect(markdown).toContain("## Trace Inventory");
    expect(markdown).toContain(
      "| UnifiedVerifier | The memo cites a Goldman Silicon Supercycle report. | 2 | 3 | 0 | 0 | 4200 | 900 | resp_123 |",
    );
  });

  it("surfaces the independent skeptic challenge pass as a reviewable audit section", () => {
    const challengedJob: Job = {
      ...job,
      findings: [
        {
          ...job.findings[0],
          skeptic_review: {
            status: "counterevidence_found",
            summary: "An issuer filing supports a different interpretation of the cited claim.",
            recommended_verdict: "uncertain",
            counterevidence: [
              {
                source: "Issuer 20-F",
                url: "https://example.com/20-f",
                snippet: "The filing describes the risk as contingent, not confirmed.",
                relevance: "Directly challenges the verifier's fabricated verdict.",
              },
            ],
          },
        },
      ],
    };

    const markdown = buildAuditPackMarkdown(challengedJob, {});

    expect(markdown).toContain("## Independent Challenge Pass");
    expect(markdown).toContain("- Reviewed findings: 1");
    expect(markdown).toContain("- Counterevidence found: 1");
    expect(markdown).toContain(
      "| fabricated | counterevidence_found | uncertain | The memo cites a Goldman Silicon Supercycle report. | An issuer filing supports a different interpretation of the cited claim. | Issuer 20-F (https://example.com/20-f): Directly challenges the verifier's fabricated verdict. |",
    );
  });

  it("derives trace tool-use counts from raw steps when aggregate counts are missing", () => {
    const traceJob: Job = {
      ...job,
      traces: [
        {
          id: "t1",
          job_id: "j1",
          claim_id: "c1",
          agent: "UnifiedVerifier",
          miromind_response_id: "resp_missing_aggregate",
          started_at: "2026-05-20T00:00:00Z",
          completed_at: "2026-05-20T00:05:00Z",
          total_tokens: 100,
          reasoning_tokens: 20,
          num_search_queries: 0,
          final_verdict_step_id: null,
          steps: [
            {
              id: "s1",
              trace_id: "t1",
              sequence: 1,
              type: "web_search",
              summary: "Search one.",
              content: {},
              evidence_ids: [],
              parent_step_id: null,
              created_at: "2026-05-20T00:01:00Z",
            },
            {
              id: "s2",
              trace_id: "t1",
              sequence: 2,
              type: "web_search",
              summary: "Search two.",
              content: {},
              evidence_ids: [],
              parent_step_id: null,
              created_at: "2026-05-20T00:02:00Z",
            },
            {
              id: "s3",
              trace_id: "t1",
              sequence: 3,
              type: "fetch_url_content",
              summary: "Fetched source page.",
              content: {},
              evidence_ids: ["e1"],
              parent_step_id: "s2",
              created_at: "2026-05-20T00:03:00Z",
            },
            {
              id: "s4",
              trace_id: "t1",
              sequence: 4,
              type: "execute_python",
              summary: "Checked a calculation.",
              content: {},
              evidence_ids: [],
              parent_step_id: "s3",
              created_at: "2026-05-20T00:04:00Z",
            },
          ],
        },
      ],
    };

    const markdown = buildAuditPackMarkdown(traceJob, {});

    expect(markdown).toContain(
      "| UnifiedVerifier | The memo cites a Goldman Silicon Supercycle report. | 4 | 2 | 1 | 1 | 100 | 20 | resp_missing_aggregate |",
    );
  });

  it("includes claim coverage and source-quality rationale for each finding", () => {
    const qualityJob: Job = {
      ...job,
      findings: [
        {
          ...job.findings[0],
          coverage: [
            {
              claim_fragment: "Goldman Silicon Supercycle report",
              relation: "not_found",
              evidence_ids: ["e1"],
              reason: "Exact-title search and source lookup did not find the cited report.",
            },
          ],
          evidence_quality: [
            {
              evidence_id: "e1",
              authority: 0.82,
              independence: 0.76,
              freshness: 0.91,
              directness: 0.88,
              role: "negative evidence",
              rationale: "Search result coverage is recent and directly probes the exact cited title.",
            },
          ],
        },
      ],
    };

    const markdown = buildAuditPackMarkdown(qualityJob, {});

    expect(markdown).toContain("Coverage matrix:");
    expect(markdown).toContain(
      "| Goldman Silicon Supercycle report | not_found | Search results | Exact-title search and source lookup did not find the cited report. |",
    );
    expect(markdown).toContain("Evidence quality:");
    expect(markdown).toContain(
      "| Search results | negative evidence | 82% | 76% | 91% | 88% | Search result coverage is recent and directly probes the exact cited title. |",
    );
  });
});
