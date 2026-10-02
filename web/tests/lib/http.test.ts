import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ArgusApiError } from "@/lib/http";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pendingFetch() {
  let receivedSignal: AbortSignal | null | undefined;
  const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    receivedSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(receivedSignal?.reason);
      if (receivedSignal?.aborted) abort();
      else receivedSignal?.addEventListener("abort", abort, { once: true });
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, signal: () => receivedSignal };
}

describe("apiFetch cancellation and deadlines", () => {
  it.each([false, true])("enforces its timeout with caller signal present: %s", async (external) => {
    const request = pendingFetch();
    const caller = new AbortController();
    const result = apiFetch("/jobs", external ? { signal: caller.signal } : {}, 100);
    const rejected = expect(result).rejects.toMatchObject({
      name: "ArgusApiError",
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(request.signal()?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation and its reason", async () => {
    const request = pendingFetch();
    const caller = new AbortController();
    const result = apiFetch("/jobs", { signal: caller.signal }, 100);
    const reason = new DOMException("navigation cancelled", "AbortError");
    const rejected = expect(result).rejects.toBe(reason);
    caller.abort(reason);
    await rejected;
    expect(request.signal()?.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors an already cancelled signal", async () => {
    const request = pendingFetch();
    const caller = new AbortController();
    const reason = new Error("cancelled before the request");
    caller.abort(reason);
    await expect(apiFetch("/jobs", { signal: caller.signal }, 100)).rejects.toBe(reason);
    expect(request.signal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reclassify a slow caller cancellation as a timeout", async () => {
    const caller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        setTimeout(() => reject(init.signal?.reason), 200);
      }, { once: true });
    })));
    const result = apiFetch("/jobs", { signal: caller.signal }, 100);
    const rejected = expect(result).rejects.toBe(reason);
    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
  });

  it("keeps the timeout error if the caller cancels later", async () => {
    const caller = new AbortController();
    pendingFetch();
    const result = apiFetch("/jobs", { signal: caller.signal }, 100);
    const rejected = expect(result).rejects.toBeInstanceOf(ArgusApiError);
    await vi.advanceTimersByTimeAsync(100);
    caller.abort(new Error("late cancellation"));
    await rejected;
  });

  it.each(["success", "network error"])("cleans up timers and listeners on %s", async (outcome) => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const response = new Response("ok");
    const error = new TypeError("network failed");
    let receivedSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => {
      receivedSignal = init.signal;
      return outcome === "success" ? Promise.resolve(response) : Promise.reject(error);
    }));
    const result = apiFetch("/jobs", { signal: caller.signal }, 100);
    if (outcome === "success") await expect(result).resolves.toBe(response);
    else await expect(result).rejects.toBe(error);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    caller.abort();
    expect(receivedSignal?.aborted).toBe(false);
  });

  it("forwards the original request unchanged without a timeout", async () => {
    const caller = new AbortController();
    const init = { method: "POST", signal: caller.signal, body: "payload" };
    const response = new Response("ok");
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);
    await expect(apiFetch("/jobs", init)).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledWith("/api/argus/jobs", init);
    expect(vi.getTimerCount()).toBe(0);
  });
});
