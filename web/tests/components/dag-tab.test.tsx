import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DagTab, _buildGraph } from "@/components/dag-tab";
import type { ReasoningTrace } from "@/lib/types";

const trace: ReasoningTrace = {
  id: "t1",
  job_id: "j1",
  claim_id: "c1",
  agent: "UnifiedVerifier",
  miromind_response_id: "r1",
  started_at: "2026-05-20T00:00:00Z",
  completed_at: null,
  total_tokens: 0,
  reasoning_tokens: 0,
  num_search_queries: 0,
  final_verdict_step_id: null,
  steps: [
    { id: "a", trace_id: "t1", sequence: 1, type: "thinking", summary: "a", content: {}, evidence_ids: [], parent_step_id: null, created_at: "2026-05-20T00:00:00Z" },
    { id: "b", trace_id: "t1", sequence: 2, type: "web_search", summary: "b", content: {}, evidence_ids: [], parent_step_id: "a", created_at: "2026-05-20T00:00:00Z" },
    { id: "c", trace_id: "t1", sequence: 3, type: "message", summary: "c", content: {}, evidence_ids: [], parent_step_id: "b", created_at: "2026-05-20T00:00:00Z" },
  ],
};

describe("DagTab", () => {
  it("_buildGraph returns nodes and edges from steps", () => {
    const { nodes, edges } = _buildGraph(trace);
    expect(nodes).toHaveLength(3);
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "a", target: "b" }),
        expect.objectContaining({ source: "b", target: "c" }),
      ]),
    );
  });

  it("empty state when no trace given", () => {
    render(<DagTab trace={null} />);
    expect(screen.getByText(/select a finding to see its reasoning graph/i)).toBeInTheDocument();
  });
});
