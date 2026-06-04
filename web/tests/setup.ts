import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (
  typeof window !== "undefined" &&
  typeof window.localStorage?.getItem !== "function"
) {
  const storage = new Map<string, string>();
  const localStorageShim: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageShim,
  });
}

// `process.cwd()` is the `web/` directory when vitest runs via `pnpm test`.
const ROOT = process.cwd();

// Minimal fetch shim that resolves bundled demo fixtures from public/.
const originalFetch = globalThis.fetch;
const fixtureByUrl = new Map([
  ["/sample-findings.json", "sample-findings.json"],
  ["/sample-findings-legal.json", "sample-findings-legal.json"],
]);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  for (const [suffix, filename] of fixtureByUrl) {
    if (url.endsWith(suffix)) {
      const body = readFileSync(resolve(ROOT, "public", filename), "utf8");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return originalFetch ? originalFetch(input, init) : Promise.reject(new Error("no fetch"));
}) as unknown as typeof fetch;
