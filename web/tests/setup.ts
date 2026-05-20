import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `process.cwd()` is the `web/` directory when vitest runs via `pnpm test`.
const ROOT = process.cwd();

// Minimal fetch shim that resolves /sample-findings.json from public/.
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.endsWith("/sample-findings.json")) {
    const body = readFileSync(resolve(ROOT, "public/sample-findings.json"), "utf8");
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch ? originalFetch(input, init) : Promise.reject(new Error("no fetch"));
}) as unknown as typeof fetch;
