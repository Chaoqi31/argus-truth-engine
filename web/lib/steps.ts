import type { ReasoningTrace, Step } from "@/lib/types";

/** Maps each step id to its 1-based position in the trace it belongs to. */
export function stepOrdinals(steps: Step[]): Map<string, number> {
  const sorted = steps;
  return new Map(sorted.map((s, i) => [s.id, i + 1]));
}

/** Tool calls a trace made. Searches are MiroMind's reported count, or the
 * search steps when it reported none. */
export function toolCounts(trace: ReasoningTrace): {
  searches: number;
  fetches: number;
  codeSteps: number;
} {
  const searchSteps = trace.steps.filter((step) => step.type === "web_search").length;
  return {
    searches: trace.usage.num_search_queries > 0 ? trace.usage.num_search_queries : searchSteps,
    fetches: trace.steps.filter((step) => step.type === "fetch_url_content").length,
    codeSteps: trace.steps.filter(
      (step) => step.type === "execute_python" || step.type === "execute_command",
    ).length,
  };
}
