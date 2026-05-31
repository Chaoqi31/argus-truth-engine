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

export async function loadSampleJob(): Promise<Job> {
  const resp = await fetch("/sample-findings.json");
  if (!resp.ok) {
    throw new Error(`failed to load sample-findings.json: ${resp.status}`);
  }
  const text = await resp.text();
  return loadJobFromJsonString(text);
}
