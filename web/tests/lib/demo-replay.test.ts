import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { orderFindingsForDemoReplay } from "@/lib/demo-replay";
import type { Job } from "@/lib/types";

describe("orderFindingsForDemoReplay", () => {
  it("starts the NVIDIA walkthrough with an evidence-backed issue", () => {
    const job = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/sample-findings.json"), "utf8"),
    ) as Job;

    const first = orderFindingsForDemoReplay(job)[0];

    expect(first?.verdict).toBe("fabricated");
    expect(first?.evidence_ids.length).toBeGreaterThan(0);
  });
});
