"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStoreApi,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useReducedMotion } from "motion/react";
import "@xyflow/react/dist/style.css";
import { useArgusStore } from "@/lib/store";
import type { Evidence, ReasoningTrace, Step, StepType } from "@/lib/types";
import { stepIcon } from "@/lib/colors";
import { sortStepsBySequence, stepOrdinals } from "@/lib/steps";

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

// Node geometry — kept here so DagTab can re-derive a node's centre for the
// recenter effect without re-measuring the DOM.
const NODE_WIDTH = 280;
const NODE_HEIGHT = 72;

export function _buildGraph(trace: ReasoningTrace): { nodes: Node[]; edges: Edge[] } {
  const sorted = sortStepsBySequence(trace.steps);
  const nodes: Node[] = sorted.map((s: Step, i: number) => ({
    id: s.id,
    position: { x: 240, y: i * 110 },
    data: { step: s, label: `${stepIcon[s.type]}  ${s.type}\n${truncate(s.summary, 120)}` },
    style: {
      background: TYPE_TINT[s.type],
      border: `1.5px solid ${TYPE_BORDER[s.type]}`,
      borderRadius: 10,
      padding: 10,
      fontSize: 12,
      fontWeight: 500,
      whiteSpace: "pre-wrap",
      width: NODE_WIDTH,
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

/**
 * The "verdict" step is where the agent commits to its answer. Traces don't
 * reliably populate `final_verdict_step_id`, so we derive it: the last
 * `message` step by sequence, else the highest-sequence step overall.
 */
function verdictStepId(trace: ReasoningTrace): string | null {
  const sorted = sortStepsBySequence(trace.steps);
  if (sorted.length === 0) return null;
  const messages = sorted.filter((s) => s.type === "message");
  return (messages.at(-1) ?? sorted.at(-1))!.id;
}

interface Props {
  trace: ReasoningTrace | null;
}

export function DagTab({ trace }: Props) {
  const job = useArgusStore((s) => s.job);
  const highlightedStepId = useArgusStore((s) => s.highlightedStepId);
  const setHighlightedStep = useArgusStore((s) => s.setHighlightedStep);
  const setEvidenceDiff = useArgusStore((s) => s.setEvidenceDiff);

  // Tracks the node the user clicked directly. A cross-link from elsewhere in
  // the cockpit (`highlightedStepId`) takes precedence, so the displayed step
  // is *derived* below rather than mirrored into state via an effect.
  const [clickedId, setClickedId] = useState<string | null>(null);

  // The base graph (positions + edges) is stable per trace and unit-tested via
  // `_buildGraph`; node decoration (verdict / highlight) is layered on below.
  const base = useMemo(() => (trace ? _buildGraph(trace) : null), [trace]);
  const verdictId = useMemo(() => (trace ? verdictStepId(trace) : null), [trace]);

  // Controlled node/edge state. This is the load-bearing part of the edge fix:
  // xyflow writes measured dimensions + handle bounds back onto these node
  // objects via `onNodesChange`. Without controlled state, every fresh node
  // array (e.g. a re-render that re-decorates) makes `adoptUserNodes` re-create
  // the internal node and reset `measured`/`handleBounds` to empty — so
  // `getEdgePosition` returns null and no edges ever render. (The component
  // remounts per trace via `key={trace.id}`, so seeding from state is correct.)
  const [nodes, setNodes, onNodesChange] = useNodesState(base?.nodes ?? []);
  const [edges, , onEdgesChange] = useEdgesState(base?.edges ?? []);

  // Stable id list (per trace) for the forced measurement in MeasureOnMount.
  const nodeIds = useMemo(() => (base ? base.nodes.map((n) => n.id) : []), [base]);

  // Decorate nodes: verdict gets a ring + VERDICT tag, the highlighted node a
  // stronger glow ring. We recompute styling from the undecorated base each
  // time (so un-highlighting reverts cleanly) but merge it onto the *current*
  // state nodes, preserving the measured dims / handle bounds xyflow committed.
  useEffect(() => {
    if (!base) return;
    const baseById = new Map(base.nodes.map((n) => [n.id, n]));
    setNodes((nds) =>
      nds.map((n) => {
        const b = baseById.get(n.id) ?? n;
        return decorateNode(n, b, n.id === verdictId, n.id === highlightedStepId);
      }),
    );
  }, [base, verdictId, highlightedStepId, setNodes]);

  if (!trace || !base) {
    return (
      <p className="p-6 text-sm text-muted-foreground">Select a finding to see its reasoning graph.</p>
    );
  }

  // Highlight (cross-link) wins over a local click; auto-opens that step's
  // detail without an effect-driven setState.
  const displayedId = highlightedStepId ?? clickedId;
  const selected = displayedId
    ? trace.steps.find((s) => s.id === displayedId) ?? null
    : null;

  // Map step ids to small 1-based ordinals so StepDetail shows "step 3 of 15"
  // instead of the large raw `sequence`.
  const ordinals = stepOrdinals(trace.steps);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    const step = (node.data as { step?: Step }).step;
    if (step) {
      setClickedId(step.id);
      setHighlightedStep(step.id);
    }
  };

  // The finding that owns this trace — needed to open the evidence-diff surface.
  const findingId = job?.findings.find((f) => f.reasoning_trace_id === trace.id)?.id ?? null;

  return (
    <div className="relative h-[640px] w-full">
      <ReactFlow
        key={trace.id} /* remount on trace switch so fitView re-runs */
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        {/* Both children live inside <ReactFlow> so they can use the flow context. */}
        <MeasureOnMount nodeIds={nodeIds} />
        <ViewportFocus nodes={base.nodes} highlightedStepId={highlightedStepId} />
      </ReactFlow>

      {selected && (
        <StepDetail
          step={selected}
          ordinal={ordinals.get(selected.id) ?? 0}
          total={trace.steps.length}
          evidence={(job?.evidences ?? []).filter((e) => e.retrieved_by_step_id === selected.id)}
          onOpenEvidence={
            findingId
              ? (evidenceId) => setEvidenceDiff({ findingId, evidenceId })
              : null
          }
          onClose={() => {
            setClickedId(null);
            setHighlightedStep(null);
          }}
        />
      )}

      <p className="pointer-events-none absolute left-3 top-3 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground shadow-[var(--shadow-card)]">
        Click any node to inspect raw thinking
      </p>
    </div>
  );
}

/**
 * Forces xyflow to measure every node once, committing each node's dimensions
 * and handle bounds to the store. Without this, edges never render: xyflow
 * relies on a per-node ResizeObserver to measure nodes and commit their
 * `measured` size + handle bounds, but that callback is delivered on the
 * browser's rendering loop — which is suspended whenever the tab is
 * backgrounded. While suspended, nodes stay unmeasured, so `getEdgePosition`
 * returns null and no edges (or visible nodes) ever appear.
 *
 * We side-step the rendering loop entirely: an effect reads each node element's
 * already-laid-out box and calls the store's `updateNodeInternals` directly
 * (no rAF). Paired with the controlled `useNodesState`, the committed
 * dimensions persist across re-decorations. Lives inside `<ReactFlow>` for the
 * provider context.
 */
function MeasureOnMount({ nodeIds }: { nodeIds: string[] }) {
  const store = useStoreApi();

  useEffect(() => {
    if (nodeIds.length === 0) return;

    // The system-level commit needs the flow's root `domNode`, which xyflow
    // populates from its own effect — and effects run child-before-parent, so
    // it can still be null when this one first fires. We can't poll with rAF
    // (the rendering loop is suspended while the tab is backgrounded), so we
    // subscribe to the store and commit the moment `domNode` appears. The
    // store notifies synchronously, so this lands within the same commit.
    let done = false;
    const commit = (): boolean => {
      if (done) return true;
      const { domNode, updateNodeInternals } = store.getState();
      if (!domNode) return false;
      done = true; // set before committing: updateNodeInternals re-enters subscribers
      const updates = new Map();
      for (const id of nodeIds) {
        const el = domNode.querySelector(`.react-flow__node[data-id="${id}"]`);
        if (el) updates.set(id, { id, nodeElement: el, force: true });
      }
      if (updates.size > 0) updateNodeInternals(updates);
      return true;
    };

    if (commit()) return;
    const unsubscribe = store.subscribe(() => {
      if (commit()) unsubscribe();
    });
    return unsubscribe;
  }, [nodeIds, store]);

  return null;
}

// Recomputes a node's label + style from its undecorated `base` form, applying
// the verdict ring/tag and (winning over it) the highlight ring. Returns a new
// node spread from `current` so xyflow's committed `measured` / handle bounds
// survive the update.
function decorateNode(
  current: Node,
  base: Node,
  isVerdict: boolean,
  isHighlighted: boolean,
): Node {
  const label =
    isVerdict && typeof base.data.label === "string"
      ? `${base.data.label}\n▸ VERDICT`
      : base.data.label;
  // Base style uses the `border` shorthand, so the rings override the same
  // shorthand (rather than borderColor/borderWidth longhands) — mixing the two
  // forms makes React warn when a ring is removed on a later render.
  const style = { ...(base.style ?? {}) };
  if (isVerdict) {
    style.border = "2px solid var(--cc-primary)";
    style.boxShadow = "0 0 0 3px var(--color-primary-soft)";
  }
  if (isHighlighted) {
    style.border = "2px solid var(--cc-primary)";
    style.boxShadow = "0 0 0 2px var(--cc-primary)";
  }
  return { ...current, data: { ...current.data, label }, style };
}

/**
 * Recenters the viewport on the highlighted node. Rendered as a child of
 * `<ReactFlow>` so `useReactFlow()` resolves the provider context that the
 * flow already supplies (no separate `ReactFlowProvider` needed).
 */
function ViewportFocus({
  nodes,
  highlightedStepId,
}: {
  nodes: Node[];
  highlightedStepId: string | null;
}) {
  const { setCenter } = useReactFlow();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!highlightedStepId) return;
    const node = nodes.find((n) => n.id === highlightedStepId);
    if (!node) return;
    const cx = node.position.x + NODE_WIDTH / 2;
    const cy = node.position.y + NODE_HEIGHT / 2;
    setCenter(cx, cy, { zoom: 1.15, duration: reduceMotion ? 0 : 600 });
  }, [highlightedStepId, nodes, setCenter, reduceMotion]);

  return null;
}

function StepDetail({
  step,
  ordinal,
  total,
  evidence,
  onOpenEvidence,
  onClose,
}: {
  step: Step;
  ordinal: number;
  total: number;
  evidence: Evidence[];
  onOpenEvidence: ((evidenceId: string) => void) | null;
  onClose: () => void;
}) {
  const c = step.content as Record<string, unknown>;
  const thought = typeof c.thought === "string" ? c.thought : null;
  const url = typeof c.url === "string" ? c.url : null;
  const query = typeof c.query === "string" ? c.query : null;
  const code = typeof c.code === "string" ? c.code : null;

  return (
    <div
      role="dialog"
      aria-label="Step detail"
      className="absolute bottom-3 left-3 right-3 z-10 max-h-[60%] overflow-y-auto rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--shadow-card-hover)]"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base">{stepIcon[step.type]}</span>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {step.type} · step {ordinal} of {total}
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

      <div className="mt-3">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Evidence retrieved here ({evidence.length})
        </p>
        {evidence.length > 0 ? (
          <ul className="space-y-2">
            {evidence.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onOpenEvidence?.(e.id)}
                  disabled={!onOpenEvidence}
                  aria-label={`Compare claim against ${e.citation}`}
                  className="group w-full rounded-[10px] border border-border bg-muted/40 px-3 py-2.5 text-left transition-colors hover:border-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:hover:border-border"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {e.source_type}
                    </span>
                    {onOpenEvidence && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        compare
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium break-words">{e.citation}</p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[10px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            No evidence retrieved at this step.
          </p>
        )}
      </div>
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
