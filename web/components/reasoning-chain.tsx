"use client";

import type { ConfidenceBreakdownData, ReasoningStepData } from "@/lib/types";

const STEP_ICONS: Record<string, string> = {
  premise: "📋",
  search: "🔍",
  evidence_found: "📄",
  comparison: "⚖️",
  inference: "💡",
  verification: "✅",
  challenge: "⚔️",
  resolution: "🏁",
};

export function ReasoningChain({ steps }: { steps: ReasoningStepData[] }) {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 border-l-2 border-primary/20 pl-3">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Reasoning chain
      </p>
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-1.5 text-xs">
          <span className="mt-0.5 shrink-0 text-[11px]">
            {STEP_ICONS[step.step] ?? "⚙"}
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-muted-foreground">{step.content}</span>
            {step.confidence_delta !== 0 && (
              <span
                className={`ml-1 font-mono text-[10px] ${
                  step.confidence_delta > 0 ? "text-green-600" : "text-red-500"
                }`}
              >
                {step.confidence_delta > 0 ? "+" : ""}
                {step.confidence_delta.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConfidenceBreakdown({ data }: { data: ConfidenceBreakdownData }) {
  const factors = [
    { label: "Source agreement", value: data.source_agreement },
    { label: "Source authority", value: data.source_authority },
    { label: "Evidence freshness", value: data.evidence_freshness },
    { label: "Evidence specificity", value: data.evidence_specificity },
  ];

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Confidence breakdown
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {factors.map((f) => (
          <div key={f.label} className="flex items-center gap-1.5 text-xs">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70 transition-all"
                style={{ width: `${f.value * 100}%` }}
              />
            </div>
            <span className="w-16 shrink-0 truncate text-[10px] text-muted-foreground">
              {f.label}
            </span>
          </div>
        ))}
      </div>
      {data.reasoning && (
        <p className="text-[10px] italic text-muted-foreground">{data.reasoning}</p>
      )}
    </div>
  );
}

export function ChallengeResult({ result }: { result: string }) {
  const succeeded = result.includes("SUCCEEDED");
  return (
    <div
      className={`mt-2 rounded-md border px-2 py-1 text-xs ${
        succeeded
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          : "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200"
      }`}
    >
      <span className="font-medium">
        {succeeded ? "⚔️ Challenge succeeded" : "🛡️ Challenge survived"}
      </span>
      <span className="ml-1">&mdash; {result.split(": ").slice(1).join(": ")}</span>
    </div>
  );
}
