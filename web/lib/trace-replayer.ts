import type { Step, StepType } from "@/lib/types";

export interface ReplayOptions {
  /** Fixed interval (ms). If omitted, per-step variable timing is used. */
  intervalMs?: number;
  /** Speed multiplier on top of the variable timing (1 = default). */
  speed?: number;
  signal?: AbortSignal;
}

/** Per-step-type default delays in milliseconds — mimic the natural rhythm of MiroMind's SSE stream. */
const STEP_DELAY: Record<StepType, number> = {
  thinking: 90,
  message: 250,
  tool_call: 280,
  execute_python: 420,
  execute_command: 420,
  web_search: 550,
  fetch_url_content: 700,
};

export function replayTrace(
  steps: ReadonlyArray<Step>,
  onStep: (step: Step) => void,
  opts: ReplayOptions = {},
): Promise<void> {
  const speed = opts.speed ?? 1;
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);
  const delayFor = (step: Step): number =>
    opts.intervalMs !== undefined
      ? opts.intervalMs / speed
      : (STEP_DELAY[step.type] ?? 250) / speed;

  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (opts.signal?.aborted) {
        resolve();
        return;
      }
      if (i >= sorted.length) {
        resolve();
        return;
      }
      const step = sorted[i++];
      if (!step) {
        resolve();
        return;
      }
      onStep(step);
      setTimeout(tick, delayFor(step));
    };
    // First step has a small priming delay so the "Replay" button visibly engages.
    setTimeout(tick, 120);
  });
}
