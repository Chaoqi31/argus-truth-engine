import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { eventsOf } from "@/app/audit/lib/events";
import { applyEvent, emptyJob } from "@/lib/live-job";
import type { Job } from "@/lib/generated/argus";

const SAMPLES = ["sample-findings.json", "sample-findings-legal.json"];

function sample(name: string): Job {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "public", name), "utf8"),
  ) as Job;
}

/** Findings, evidence and traces come out in the order the run recorded them,
 * which the replay reconstructs stage by stage rather than concurrently. Each
 * trace still carries its steps in order; the view sorts the rest. */
function byId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function comparable(job: Job): Job {
  return {
    ...job,
    findings: byId(job.findings),
    evidences: byId(job.evidences),
    traces: byId(job.traces),
  };
}

describe("the demo replays itself", () => {
  it.each(SAMPLES)("%s rebuilds from its own events", (name) => {
    const finished = sample(name);
    let job = emptyJob(finished);
    for (const event of eventsOf(finished)) {
      job = applyEvent(job, event);
    }

    expect(comparable(job)).toEqual(comparable(finished));
    expect(job.version).toBe(finished.version);
  });
});
