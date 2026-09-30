import { describe, expect, it } from "vitest";
import {
  isCitationClaim,
  type Claim,
  type Finding,
  type FindingVerdict,
  type Job,
  type Severity,
} from "@/lib/types";
import { makeClaim, makeFinding, makeJob } from "@/tests/factories";

const sampleClaim: Claim = makeClaim({
  id: "c1",
  text: "Smith (2021) found X.",
  page: 1,
  span: [0, 22],
  type: "citation",
  importance: "high",
  extracted_metadata: { authors: ["Smith"], year: 2021 },
  context: "",
});

describe("types", () => {
  it("isCitationClaim narrows on type=citation", () => {
    expect(isCitationClaim(sampleClaim)).toBe(true);
    expect(isCitationClaim({ ...sampleClaim, type: "qualitative" })).toBe(false);
  });

  it("Finding/Job/Severity enums are typed", () => {
    const sev: Severity = "major";
    const verdict: FindingVerdict = "fabricated";
    const f: Finding = makeFinding({
      id: "f1",
      claim_id: "c1",
      agent: "verifier",
      verdict,
      severity: sev,
      confidence: 0.9,
      summary: "No DOI found.",
      evidence_ids: ["e1"],
      reasoning_trace_id: "t1",
      created_at: "2026-05-20T00:00:00Z",
    });
    const j: Job = makeJob({
      id: "j1",
      pdf_path: "x.pdf",
      status: "done",
      created_at: "2026-05-20T00:00:00Z",
      completed_at: "2026-05-20T00:01:00Z",
      cost_usd: 0,
      total_tokens: 100,
      audit_report_md: null,
      claims: [sampleClaim],
      findings: [f],
      traces: [],
      evidences: [],
    });
    expect(j.findings[0]?.verdict).toBe("fabricated");
  });
});
