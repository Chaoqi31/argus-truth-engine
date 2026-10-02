// The live job socket. Every connection opens with the whole job and then
// carries each change to it, so reconnecting, reloading and opening a second
// tab are the same case: the snapshot replaces whatever the client had, and
// the frames after it are the only ones applied.
import type { EventFrame, Job, SnapshotFrame } from "./generated/argus";

export interface JobSocketCallbacks {
  onSnapshot: (job: Job) => void;
  onEvent: (frame: EventFrame) => void;
  /** Advisory: a transient transport problem. The reconnect on close decides. */
  onError?: (err: Error) => void;
  /** The reconnect budget is spent. Terminal, no more attempts. */
  onGiveUp?: () => void;
}

export interface JobSocketOptions {
  wsHost?: string;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  accessToken?: string | null;
}

/** The server refused the connection or has no such job. */
const POLICY_VIOLATION = 1008;

/** Where the API's WebSocket lives. Next's rewrites do not upgrade sockets,
 * so the web reaches the API directly: same host, the API's port, unless
 * NEXT_PUBLIC_ARGUS_WS_HOST says otherwise. */
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

function socketUrl(host: string, jobId: string, token?: string | null): string {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:";
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return `${secure ? "wss" : "ws"}://${host}/ws/jobs/${encodeURIComponent(jobId)}${query}`;
}

function isTerminal(job: Job): boolean {
  return job.status === "done" || job.status === "failed";
}

export function watchJob(
  jobId: string,
  callbacks: JobSocketCallbacks,
  opts: JobSocketOptions = {},
): () => void {
  const host = resolveHost(opts.wsHost);
  const reconnectDelayMs = opts.reconnectDelayMs ?? 1500;
  const maxReconnectAttempts = opts.maxReconnectAttempts ?? 20;

  let version = 0;
  let finished = false;
  let disposed = false;
  let attempts = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (disposed || finished) return;
    const ws = new WebSocket(socketUrl(host, jobId, opts.accessToken));
    socket = ws;
    version = 0;

    ws.onmessage = (msg) => {
      let frame: SnapshotFrame | EventFrame;
      try {
        frame = JSON.parse(String(msg.data)) as SnapshotFrame | EventFrame;
      } catch (err) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (frame.type === "snapshot") {
        // A completed handshake alone does not mean the stream recovered.
        // Reset the budget only after the server has delivered the job.
        attempts = 0;
        callbacks.onSnapshot(frame.job);
        if (isTerminal(frame.job)) {
          finished = true;
          ws.close(1000, "terminal");
        }
        return;
      }
      if (frame.version <= version) return;
      version = frame.version;
      callbacks.onEvent(frame);
      if (frame.event.type === "finished") {
        finished = true;
        ws.close(1000, "terminal");
      }
    };

    ws.onerror = () => {
      callbacks.onError?.(new Error("connection lost"));
    };

    ws.onclose = (event) => {
      socket = null;
      if (disposed || finished) return;
      if (event.code === POLICY_VIOLATION) {
        callbacks.onGiveUp?.();
        return;
      }
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
        /* the socket was already closing */
      }
    }
  };
}
