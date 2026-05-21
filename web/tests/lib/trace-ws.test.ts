import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeTrace } from "@/lib/trace-ws";
import type { TraceEvent } from "@/lib/trace-ws";

// Minimal in-memory WebSocket stand-in.
class FakeSocket {
  static instances: FakeSocket[] = [];
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
    queueMicrotask(() => {
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
  FakeSocket.instances = [];
  (globalThis as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flush() {
  // Allow queueMicrotask + setTimeout(0) to drain.
  await new Promise((r) => setTimeout(r, 0));
}

describe("subscribeTrace", () => {
  it("opens ws://host/ws/jobs/{id}/trace?after=0 and dispatches events", async () => {
    const events: TraceEvent[] = [];
    const disconnect = subscribeTrace(
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

  it("reconnects with ?after=<lastSeq> on abnormal close, no reconnect after terminal", async () => {
    const events: TraceEvent[] = [];
    const closeReports: boolean[] = [];
    subscribeTrace(
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
    subscribeTrace(
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
    const disconnect = subscribeTrace(
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
});
