import type { Step } from "@/lib/types";

/** Returns a new array of steps sorted ascending by `sequence`. */
export function sortStepsBySequence(steps: Step[]): Step[] {
  return [...steps].sort((a, b) => a.sequence - b.sequence);
}

/**
 * Maps each step id to its 1-based ordinal within the trace, ordered by
 * `sequence`. The raw `sequence` is a large internal counter (e.g. 4259), so UI
 * that surfaces it ("step 4259") reads as broken; the ordinal ("step 3 of 15")
 * is what users expect.
 */
export function stepOrdinals(steps: Step[]): Map<string, number> {
  const sorted = sortStepsBySequence(steps);
  return new Map(sorted.map((s, i) => [s.id, i + 1]));
}
