"use client";

import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ReasoningTrace, Step, StepType } from "@/lib/types";

const TYPE_TINT: Record<StepType, string> = {
  thinking: "#dbeafe",
  web_search: "#ede9fe",
  fetch_url_content: "#dcfce7",
  execute_python: "#f3f4f6",
  execute_command: "#e5e7eb",
  tool_call: "#fef3c7",
  message: "#fee2e2",
};

export function _buildGraph(trace: ReasoningTrace): { nodes: Node[]; edges: Edge[] } {
  const sorted = [...trace.steps].sort((a, b) => a.sequence - b.sequence);
  const nodes: Node[] = sorted.map((s: Step, i: number) => ({
    id: s.id,
    position: { x: 240, y: i * 120 },
    data: { label: `${s.type}\n${truncate(s.summary, 60)}` },
    style: {
      background: TYPE_TINT[s.type],
      border: "1px solid #d1d5db",
      borderRadius: 8,
      padding: 8,
      fontSize: 12,
      whiteSpace: "pre-wrap",
      width: 260,
    },
  }));
  const edges: Edge[] = sorted
    .filter((s) => s.parent_step_id !== null)
    .map((s) => ({
      id: `${s.parent_step_id}->${s.id}`,
      source: s.parent_step_id as string,
      target: s.id,
      type: "smoothstep",
    }));
  return { nodes, edges };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

interface Props {
  trace: ReasoningTrace | null;
}

export function DagTab({ trace }: Props) {
  if (!trace) {
    return (
      <p className="p-6 text-sm text-muted-foreground">No reasoning chain available.</p>
    );
  }
  const { nodes, edges } = _buildGraph(trace);
  return (
    <div className="h-[600px] w-full">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
