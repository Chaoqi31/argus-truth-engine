import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFrame, isTerminal } from "@/lib/live-job";
import type { EventFrame, Job } from "@/lib/generated/argus";

interface RecordedRun {
  initial: Job;
  frames: EventFrame[];
  final: Job;
}

const RUNS_DIR = resolve(process.cwd(), "tests/fixtures/runs");

function recordedRuns(): [string, RecordedRun][] {
  return readdirSync(RUNS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [
      name,
      JSON.parse(readFileSync(resolve(RUNS_DIR, name), "utf8")) as RecordedRun,
    ]);
}

describe("the fold reproduces the server's job", () => {
  const runs = recordedRuns();

  it("has runs to replay", () => {
    expect(runs.length).toBeGreaterThan(0);
  });

  it.each(runs)("%s", (_name, run) => {
    let job = run.initial;
    for (const frame of run.frames) {
      expect(frame.version).toBe(job.version + 1);
      job = applyFrame(job, frame);
    }
    expect(job).toEqual(run.final);
    expect(isTerminal(job)).toBe(true);
  });
});

describe("every event type is covered by the recorded runs", () => {
  const seen = new Set(
    recordedRuns().flatMap(([, run]) => run.frames.map((frame) => frame.event.type)),
  );

  const ALL = [
    "stage_started",
    "stage_finished",
    "review_ready",
    "claims_selected",
    "trace_opened",
    "step_recorded",
    "trace_closed",
    "finding_recorded",
    "report_written",
    "finished",
  ];

  it.each(ALL)("%s", (type) => {
    expect(seen).toContain(type);
  });
});
