// HTTP plumbing shared by every call to the Argus API. Next.js rewrites
// /api/argus/* to the backend (see next.config.ts).

export const API_BASE = "/api/argus";

export class ArgusApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ArgusApiError";
  }
}

export function authHeaders(accessToken: string | null | undefined): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/** fetch against the API; deadline expiry is a 504, caller cancellation is preserved. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  if (timeoutMs === undefined) return fetch(`${API_BASE}${path}`, init);
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut && err instanceof Error && err.name === "AbortError") {
      throw new ArgusApiError(504, "Request timed out. Please retry.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

/** The server's `detail` (FastAPI's error shape) or the raw body text. */
export async function errorMessage(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    /* not JSON */
  }
  return text;
}

export async function ensureOk(resp: Response, fallback: string): Promise<void> {
  if (resp.ok) return;
  const message = await errorMessage(resp);
  throw new ArgusApiError(resp.status, message || `${fallback} (${resp.status})`);
}
