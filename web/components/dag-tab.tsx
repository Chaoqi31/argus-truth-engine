"use client";

import { useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ReasoningTrace, Step, StepType } from "@/lib/types";
import { stepIcon } from "@/lib/colors";

// Step-type colours come from CSS custom properties so they adapt to dark
// mode. See `--vis-*` tokens in globals.css.
const TYPE_TINT: Record<StepType, string> = {
  thinking: "var(--vis-thinking-bg)",
  web_search: "var(--vis-search-bg)",
  fetch_url_content: "var(--vis-fetch-bg)",
  execute_python: "var(--vis-exec-bg)",
  execute_command: "var(--vis-exec-bg)",
  tool_call: "var(--vis-tool-bg)",
  message: "var(--vis-message-bg)",
};

const TYPE_BORDER: Record<StepType, string> = {
  thinking: "var(--vis-thinking-border)",
  web_search: "var(--vis-search-border)",
  fetch_url_content: "var(--vis-fetch-border)",
  execute_python: "var(--vis-exec-border)",
  execute_command: "var(--vis-exec-border)",
  tool_call: "var(--vis-tool-border)",
  message: "var(--vis-message-border)",
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
      color: "var(--vis-node-fg)",
      boxShadow: "var(--shadow-card)",
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
