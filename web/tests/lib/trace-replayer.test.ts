import { describe, expect, it, vi } from "vitest";
import { replayTrace } from "@/lib/trace-replayer";
import type { Step } from "@/lib/types";

function step(id: string, seq: number, type: Step["type"] = "thinking"): Step {
  return {
    id,
    trace_id: "t",
    sequence: seq,
    type,
    summary: id,
    content: {},
    evidence_ids: [],
    parent_step_id: null,
    created_at: "2026-05-20T00:00:00Z",
  };
}

describe("replayTrace", () => {
  it("emits steps in sequence order", async () => {
    vi.useFakeTimers();
    const steps = [step("a", 3), step("b", 1), step("c", 2)];
    const seen: string[] = [];
    const done = replayTrace(steps, (s) => seen.push(s.id), { intervalMs: 10 });
    await vi.runAllTimersAsync();
    await done;
    expect(seen).toEqual(["b", "c", "a"]);
    vi.useRealTimers();
  });

  it("respects cancellation", async () => {
    vi.useFakeTimers();
    const steps = [step("a", 1), step("b", 2), step("c", 3)];
    const seen: string[] = [];
    const controller = new AbortController();
    const done = replayTrace(steps, (s) => seen.push(s.id), {
      intervalMs: 10,
      signal: controller.signal,
    });
    // Advance enough for one step to fire.
    await vi.advanceTimersByTimeAsync(15);
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
    expect(seen.length).toBeLessThan(3);
    vi.useRealTimers();
  });
});
