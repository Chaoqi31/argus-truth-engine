"use client";

import { useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ReasoningTrace, Step, StepType } from "@/lib/types";
import { stepIcon } from "@/lib/colors";

const TYPE_TINT: Record<StepType, string> = {
  thinking: "#dbeafe",
  web_search: "#ede9fe",
  fetch_url_content: "#dcfce7",
  execute_python: "#f3f4f6",
  execute_command: "#e5e7eb",
  tool_call: "#fef3c7",
  message: "#fee2e2",
};

const TYPE_BORDER: Record<StepType, string> = {
  thinking: "#93c5fd",
  web_search: "#c4b5fd",
  fetch_url_content: "#86efac",
  execute_python: "#d1d5db",
  execute_command: "#9ca3af",
  tool_call: "#fcd34d",
  message: "#fca5a5",
};

export function _buildGraph(trace: ReasoningTrace): { nodes: Node[]; edges: Edge[] } {
  const sorted = [...trace.steps].sort((a, b) => a.sequence - b.sequence);
  const nodes: Node[] = sorted.map((s: Step, i: number) => ({
    id: s.id,
    position: { x: 240, y: i * 110 },
    data: { step: s, label: `${stepIcon[s.type]}  ${s.type}\n${truncate(s.summary, 70)}` },
    style: {
      background: TYPE_TINT[s.type],
      border: `1.5px solid ${TYPE_BORDER[s.type]}`,
      borderRadius: 10,
      padding: 10,
      fontSize: 12,
      fontWeight: 500,
      whiteSpace: "pre-wrap",
      width: 280,
      color: "#0f172a",
      boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
    },
  }));
  const edges: Edge[] = sorted
    .filter((s) => s.parent_step_id !== null)
    .map((s) => ({
      id: `${s.parent_step_id}->${s.id}`,
      source: s.parent_step_id as string,
      target: s.id,
      type: "smoothstep",
      animated: s.type === "message",
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
  const [selected, setSelected] = useState<Step | null>(null);

  if (!trace) {
    return (
      <p className="p-6 text-sm text-muted-foreground">No reasoning chain available.</p>
    );
  }

  const { nodes, edges } = _buildGraph(trace);
  const onNodeClick: NodeMouseHandler = (_, node) => {
    const step = (node.data as { step?: Step }).step;
    if (step) setSelected(step);
  };

  return (
    <div className="relative h-[640px] w-full">
      <ReactFlow
        key={trace.id} /* remount on trace switch so fitView re-runs */
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {selected && <StepDetail step={selected} onClose={() => setSelected(null)} />}

      <p className="pointer-events-none absolute left-3 top-3 rounded-full bg-background/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground shadow-sm backdrop-blur">
        Click any node to inspect raw thinking
      </p>
    </div>
  );
}

function StepDetail({ step, onClose }: { step: Step; onClose: () => void }) {
  const c = step.content as Record<string, unknown>;
  const thought = typeof c.thought === "string" ? c.thought : null;
  const url = typeof c.url === "string" ? c.url : null;
  const query = typeof c.query === "string" ? c.query : null;
  const code = typeof c.code === "string" ? c.code : null;

  return (
    <div
      role="dialog"
      aria-label="Step detail"
      className="absolute bottom-4 right-4 z-10 max-h-[60%] w-[420px] overflow-y-auto rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--shadow-card-hover)]"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base">{stepIcon[step.type]}</span>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {step.type} · seq {step.sequence}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="mb-3 text-sm font-medium">{step.summary}</p>

      {thought && (
        <Block label="Raw thought">
          <p className="whitespace-pre-wrap font-mono text-[11px] leading-snug">{thought}</p>
        </Block>
      )}

      {url && (
        <Block label="URL fetched">
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-xs text-primary underline-offset-2 hover:underline"
          >
            {url} ↗
          </a>
        </Block>
      )}

      {query && (
        <Block label="Search query">
          <code className="block font-mono text-xs">{query}</code>
        </Block>
      )}

      {code && (
        <Block label="Python">
          <pre className="overflow-x-auto font-mono text-[11px] leading-snug">{code}</pre>
        </Block>
      )}

      {step.evidence_ids.length > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {step.evidence_ids.length} evidence linked to this step.
        </p>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="rounded-md border border-border bg-muted/40 p-2">{children}</div>
    </div>
  );
}
