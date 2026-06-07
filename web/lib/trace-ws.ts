export type TraceEventKind =
  | "started" | "step" | "finding" | "finished" | "failed"
  | "stage" | "claim" | "heartbeat"
  | "atomized" | "filtered" | "review_ready" | "review_submitted" | "resumed"
  | "claims_deduped" | "claims_capped";

export interface TraceEvent {
  job_id: string;
  sequence: number;
  kind: TraceEventKind;
  payload: Record<string, unknown>;
}

export interface TraceSubscribeCallbacks {
  onEvent: (ev: TraceEvent) => void;
  onClose?: (clean: boolean) => void;
  /** Fired on every successful open. */
  onConnected?: () => void;
  /** Advisory only — transient, never terminal. The following onclose drives reconnect/give-up. */
  onError?: (err: Error) => void;
  /** Fired once when the reconnect budget is exhausted (terminal, no more retries). */
  onGiveUp?: () => void;
}

export interface TraceSubscribeOptions {
  wsHost?: string;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  accessToken?: string | null;
}

const TERMINAL_KINDS: ReadonlySet<TraceEventKind> = new Set(["finished", "failed"]);

function resolveHost(opt?: string): string {
  if (opt) return opt;
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_ARGUS_WS_HOST) {
    return process.env.NEXT_PUBLIC_ARGUS_WS_HOST;
  }
  if (typeof window !== "undefined") {
    return `${window.location.hostname}:8080`;
  }
  return "localhost:8080";
}

export function subscribeTrace(
  jobId: string,
  callbacks: TraceSubscribeCallbacks,
  opts: TraceSubscribeOptions = {},
): () => void {
  const host = resolveHost(opts.wsHost);
  const reconnectDelayMs = opts.reconnectDelayMs ?? 1500;
  const maxReconnectAttempts = opts.maxReconnectAttempts ?? 20;

  let lastSeq = 0;
  let terminated = false;
  let disposed = false;
  let attempts = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (disposed || terminated) return;
    const protocol =
      typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ after: String(lastSeq) });
    if (opts.accessToken) params.set("token", opts.accessToken);
    const url = `${protocol}://${host}/ws/jobs/${encodeURIComponent(jobId)}/trace?${params.toString()}`;
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => {
      attempts = 0;
      callbacks.onConnected?.();
    };

    ws.onmessage = (msg) => {
      let parsed: TraceEvent;
      try {
        parsed = JSON.parse(msg.data) as TraceEvent;
      } catch (err) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (typeof parsed.sequence === "number") {
        if (parsed.sequence <= lastSeq) return;
        lastSeq = parsed.sequence;
      }
      callbacks.onEvent(parsed);
      if (TERMINAL_KINDS.has(parsed.kind)) {
        terminated = true;
        try {
          ws.close(1000, "terminal");
        } catch {
          /* ignore */
        }
      }
    };

    ws.onerror = () => {
      callbacks.onError?.(new Error("connection lost"));
    };

    ws.onclose = () => {
      socket = null;
      const clean = terminated || disposed;
      callbacks.onClose?.(clean);
      if (clean) return;
      if (attempts < maxReconnectAttempts) {
        attempts++;
        reconnectTimer = setTimeout(connect, reconnectDelayMs);
      } else {
        callbacks.onGiveUp?.();
      }
    };
  };

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket && socket.readyState <= 1) {
      try {
        socket.close(1000, "client-disconnect");
      } catch {
        /* ignore */
      }
    }
  };
}
