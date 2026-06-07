import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeTrace } from "@/lib/trace-ws";
import type { TraceEvent } from "@/lib/trace-ws";

let disconnectors: Array<() => void> = [];

function trackSubscribe(...args: Parameters<typeof subscribeTrace>) {
  const disconnect = subscribeTrace(...args);
  disconnectors.push(disconnect);
  return disconnect;
}

// Minimal in-memory WebSocket stand-in.
class FakeSocket {
  static instances: FakeSocket[] = [];
  // When > 0, the next N constructed sockets fail to connect: they fire
  // onerror then a non-clean onclose (1006) WITHOUT ever firing onopen.
  static failConnect = 0;
  readyState = 0;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closeArgs: { code?: number; reason?: string } | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    const failing = FakeSocket.failConnect > 0;
    if (failing) FakeSocket.failConnect--;
    queueMicrotask(() => {
      if (failing) {
        this.readyState = 3;
        this.onerror?.(new Event("error"));
        this.onclose?.(new CloseEvent("close", { code: 1006, reason: "abnormal" }));
        return;
      }
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }
  send() {}
  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closeArgs = { code, reason };
    this.onclose?.(new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" }));
  }
  // Test helpers
  push(ev: TraceEvent) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(ev) }));
  }
  serverDrop() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code: 1006, reason: "abnormal" }));
  }
}

beforeEach(() => {
  disconnectors = [];
  FakeSocket.instances = [];
  FakeSocket.failConnect = 0;
  (globalThis as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
});

afterEach(() => {
  for (const disconnect of disconnectors.splice(0).reverse()) {
    disconnect();
  }
  vi.restoreAllMocks();
});

async function flush() {
  // Allow queueMicrotask + setTimeout(0) to drain.
  await new Promise((r) => setTimeout(r, 0));
}

describe("subscribeTrace", () => {
  it("opens ws://host/ws/jobs/{id}/trace?after=0 and dispatches events", async () => {
    const events: TraceEvent[] = [];
    const disconnect = trackSubscribe(
      "job_abc",
      { onEvent: (ev) => events.push(ev) },
      { wsHost: "localhost:8080" },
    );

    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toBe(
      "ws://localhost:8080/ws/jobs/job_abc/trace?after=0",
    );

    FakeSocket.instances[0].push({
      job_id: "job_abc",
      sequence: 1,
      kind: "started",
      payload: {},
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("started");

    disconnect();
  });

  it("includes an access token query param when provided", async () => {
    trackSubscribe(
      "job_secure",
      { onEvent: () => {} },
      { wsHost: "localhost:8080", accessToken: "jwt_1" },
    );

    await flush();
    expect(FakeSocket.instances[0].url).toBe(
      "ws://localhost:8080/ws/jobs/job_secure/trace?after=0&token=jwt_1",
    );
  });

  it("reconnects with ?after=<lastSeq> on abnormal close, no reconnect after terminal", async () => {
    const events: TraceEvent[] = [];
    const closeReports: boolean[] = [];
    trackSubscribe(
      "job_x",
      {
        onEvent: (ev) => events.push(ev),
        onClose: (clean) => closeReports.push(clean),
      },
      { wsHost: "h:1", reconnectDelayMs: 5 },
    );

    await flush();
    const first = FakeSocket.instances[0];
    first.push({ job_id: "job_x", sequence: 1, kind: "started", payload: {} });
    first.push({ job_id: "job_x", sequence: 2, kind: "step", payload: {} });

    first.serverDrop();
    // wait for reconnect
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toBe("ws://h:1/ws/jobs/job_x/trace?after=2");

    FakeSocket.instances[1].push({
      job_id: "job_x",
      sequence: 3,
      kind: "finished",
      payload: { status: "done" },
    });
    // terminal should close the socket and not reconnect.
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeSocket.instances).toHaveLength(2);
    expect(closeReports[closeReports.length - 1]).toBe(true);
  });

  it("ignores duplicate sequence numbers after reconnect replay", async () => {
    const events: TraceEvent[] = [];
    trackSubscribe(
      "job_x",
      { onEvent: (ev) => events.push(ev) },
      { wsHost: "h:1", reconnectDelayMs: 5 },
    );

    await flush();
    FakeSocket.instances[0].push({ job_id: "job_x", sequence: 1, kind: "started", payload: {} });
    FakeSocket.instances[0].push({ job_id: "job_x", sequence: 2, kind: "step", payload: {} });
    FakeSocket.instances[0].serverDrop();

    await new Promise((r) => setTimeout(r, 20));
    FakeSocket.instances[1].push({ job_id: "job_x", sequence: 2, kind: "step", payload: {} });
    FakeSocket.instances[1].push({ job_id: "job_x", sequence: 3, kind: "finished", payload: {} });

    expect(events.map((ev) => ev.sequence)).toEqual([1, 2, 3]);
  });

  it("disconnect() stops further reconnects", async () => {
    const disconnect = trackSubscribe(
      "j",
      { onEvent: () => {} },
      { wsHost: "h:1", reconnectDelayMs: 5 },
    );
    await flush();
    disconnect();
    FakeSocket.instances[0].serverDrop();
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("fires onConnected on open and resets the reconnect budget", async () => {
    let connectedCount = 0;
    let gaveUp = false;
    trackSubscribe(
      "job_c",
      {
        onEvent: () => {},
        onConnected: () => connectedCount++,
        onGiveUp: () => {
          gaveUp = true;
        },
      },
      { wsHost: "h:1", reconnectDelayMs: 5, maxReconnectAttempts: 1 },
    );

    await flush();
    expect(connectedCount).toBe(1);

    // A mid-stream drop after a good open should reconnect (budget was reset),
    // not give up, even though maxReconnectAttempts is 1.
    FakeSocket.instances[0].serverDrop();
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeSocket.instances).toHaveLength(2);
    expect(connectedCount).toBe(2);
    expect(gaveUp).toBe(false);
  });

  it("retries transient failed connects without giving up while under budget", async () => {
    let gaveUp = false;
    let errorCount = 0;
    FakeSocket.failConnect = 2; // first two sockets fail, third succeeds
    trackSubscribe(
      "job_t",
      {
        onEvent: () => {},
        onError: () => errorCount++,
        onGiveUp: () => {
          gaveUp = true;
        },
      },
      { wsHost: "h:1", reconnectDelayMs: 5, maxReconnectAttempts: 5 },
    );

    await new Promise((r) => setTimeout(r, 40));
    // 2 failed + 1 successful = 3 sockets created.
    expect(FakeSocket.instances).toHaveLength(3);
    expect(errorCount).toBe(2);
    expect(gaveUp).toBe(false);
  });

  it("calls onGiveUp exactly once after maxReconnectAttempts failed connects", async () => {
    let giveUpCount = 0;
    FakeSocket.failConnect = 50; // every socket fails to connect
    trackSubscribe(
      "job_g",
      {
        onEvent: () => {},
        onGiveUp: () => giveUpCount++,
      },
      { wsHost: "h:1", reconnectDelayMs: 5, maxReconnectAttempts: 3 },
    );

    await new Promise((r) => setTimeout(r, 60));
    // initial + 3 reconnects = 4 sockets, then give up (no further sockets).
    expect(FakeSocket.instances).toHaveLength(4);
    expect(giveUpCount).toBe(1);

    // No further sockets after give-up.
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeSocket.instances).toHaveLength(4);
    expect(giveUpCount).toBe(1);
  });
});
