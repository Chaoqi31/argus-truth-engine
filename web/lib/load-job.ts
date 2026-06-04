import type { Job } from "@/lib/types";

const REQUIRED_KEYS: ReadonlyArray<keyof Job> = [
  "id",
  "pdf_path",
  "status",
  "created_at",
  "claims",
  "findings",
  "traces",
  "evidences",
];

export function loadJobFromJsonString(raw: string): Job {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("findings JSON must be an object");
  }
  const missing: string[] = [];
  for (const key of REQUIRED_KEYS) {
    if (!(key in parsed)) {
      missing.push(String(key));
    }
  }
  if (missing.length > 0) {
    throw new Error(`missing required fields: ${missing.join(", ")}`);
  }
  return parsed as Job;
}

export type Scenario = "nvidia" | "legal";

const SCENARIO_FILE: Record<Scenario, string> = {
  nvidia: "/sample-findings.json",
  legal: "/sample-findings-legal.json",
};

export async function loadSampleJob(scenario: Scenario = "nvidia"): Promise<Job> {
  const url = SCENARIO_FILE[scenario];
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`failed to load ${url}: ${resp.status}`);
  }
  const text = await resp.text();
  return loadJobFromJsonString(text);
}
