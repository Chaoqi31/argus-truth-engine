import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchJob } from "@/lib/job-socket";
import { makeJob } from "../factories";

class FakeSocket {
  static connections: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.connections.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const latest = () => FakeSocket.connections.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.connections = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function watch() {
  const callbacks = {
    onSnapshot: vi.fn(),
    onEvent: vi.fn(),
    onError: vi.fn(),
    onGiveUp: vi.fn(),
  };
  const stop = watchJob("job_test", callbacks, {
    maxReconnectAttempts: 2,
    reconnectDelayMs: 100,
  });
  return { callbacks, stop };
}

describe("watchJob reconnect budget", () => {
  it.each([1006, 1013])(
    "stops repeated pre-snapshot disconnects with close code %s",
    (code) => {
      const { callbacks, stop } = watch();
      for (let i = 0; i < 3; i++) {
        latest().open();
        latest().close(code);
        vi.advanceTimersByTime(100);
      }
      expect(FakeSocket.connections).toHaveLength(3);
      expect(callbacks.onGiveUp).toHaveBeenCalledTimes(1);
      expect(callbacks.onSnapshot).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      stop();
    },
  );

  it("also bounds failed handshakes", () => {
    const { callbacks, stop } = watch();
    for (let i = 0; i < 3; i++) {
      latest().close(1006);
      vi.advanceTimersByTime(100);
    }
    expect(FakeSocket.connections).toHaveLength(3);
    expect(callbacks.onGiveUp).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each([1006, 1013])("restores the budget after a snapshot before close %s", (code) => {
    const { callbacks, stop } = watch();
    for (let i = 0; i < 2; i++) {
      latest().close(1006);
      vi.advanceTimersByTime(100);
    }
    const job = makeJob({ id: "job_test", status: "running" });
    latest().message({ type: "snapshot", job });
    latest().close(code);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.connections).toHaveLength(4);
    expect(callbacks.onSnapshot).toHaveBeenCalledWith(job);
    expect(callbacks.onGiveUp).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      latest().close(1006);
      vi.advanceTimersByTime(100);
    }
    expect(callbacks.onGiveUp).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not reset the budget on malformed JSON", () => {
    const { callbacks, stop } = watch();
    for (let i = 0; i < 3; i++) {
      latest().onmessage?.({ data: "not JSON" });
      latest().close(1006);
      vi.advanceTimersByTime(100);
    }
    expect(callbacks.onError).toHaveBeenCalledTimes(3);
    expect(callbacks.onGiveUp).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not retry a policy refusal", () => {
    const { callbacks, stop } = watch();
    latest().close(1008);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.connections).toHaveLength(1);
    expect(callbacks.onGiveUp).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each(["done", "failed"] as const)("does not reconnect after a %s snapshot", (status) => {
    const { callbacks, stop } = watch();
    latest().message({ type: "snapshot", job: makeJob({ status }) });
    vi.advanceTimersByTime(100);
    expect(FakeSocket.connections).toHaveLength(1);
    expect(callbacks.onGiveUp).not.toHaveBeenCalled();
    expect(latest().readyState).toBe(3);
    stop();
  });

  it("cancels a pending reconnect when disposed", () => {
    const { callbacks, stop } = watch();
    latest().close(1006);
    stop();
    vi.advanceTimersByTime(100);
    expect(FakeSocket.connections).toHaveLength(1);
    expect(callbacks.onGiveUp).not.toHaveBeenCalled();
  });
});
