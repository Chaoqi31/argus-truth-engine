import type { Step } from "@/lib/types";

export interface ReplayOptions {
  intervalMs?: number;
  signal?: AbortSignal;
}

export function replayTrace(
  steps: ReadonlyArray<Step>,
  onStep: (step: Step) => void,
  opts: ReplayOptions = {},
): Promise<void> {
  const interval = opts.intervalMs ?? 350;
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);

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
      if (step) {
        onStep(step);
      }
      setTimeout(tick, interval);
    };
    setTimeout(tick, interval);
  });
}
