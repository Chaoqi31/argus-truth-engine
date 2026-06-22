import { useEffect } from "react";
import { getJob, JobNotFoundError } from "@/lib/api";
import { useArgusStore } from "@/lib/store";
import { subscribeTrace } from "@/lib/trace-ws";
import type { FilteredClaim, Job, ReviewClaim, RunStatus, Step } from "@/lib/types";
import {
  claimFromPayload,
  claimMarkerStep,
  findingFromPayload,
  heartbeatFromPayload,
  stageFromPayload,
  stageMarkerStep,
  stepFromPayload,
} from "../lib/trace-payload";

type AuthSlice = {
  configured: boolean;
  loading: boolean;
  accessToken: string | null;
};

export function useAuditRun(liveId: string | null, auth: AuthSlice) {
  const resetLive = useArgusStore((s) => s.resetLive);
  const appendLiveSteps = useArgusStore((s) => s.appendLiveSteps);
  const appendLiveFinding = useArgusStore((s) => s.appendLiveFinding);
  const setLiveHeartbeat = useArgusStore((s) => s.setLiveHeartbeat);
  const setRunStatus = useArgusStore((s) => s.setRunStatus);
  const setJob = useArgusStore((s) => s.setJob);
  const setConsoleMode = useArgusStore((s) => s.setConsoleMode);
  const setReviewReady = useArgusStore((s) => s.setReviewReady);

  useEffect(() => {
    if (!liveId) return;
    if (auth.configured && auth.loading) return;
    resetLive();
    setRunStatus("connecting");
    const requestOptions = { accessToken: auth.accessToken };

    let cancelled = false;
    let disconnect: () => void = () => {};
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingSteps: Step[] = [];
    const seenStageKeys = new Set<string>();
    let settled = false;

    const flushSteps = () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pendingSteps.length === 0) return;
      const next = pendingSteps;
      pendingSteps = [];
      appendLiveSteps(next);
    };

    const enqueueStep = (step: Step) => {
      pendingSteps.push(step);
      if (flushTimer !== null) return;
      flushTimer = setTimeout(flushSteps, 80);
    };

    const enqueueStage = (
      key: string,
      name: string,
      engine: string,
      summary: string,
      sequence = 0,
    ) => {
      if (seenStageKeys.has(key)) return;
      seenStageKeys.add(key);
      enqueueStep(stageMarkerStep(key, name, engine, summary, sequence));
    };

    const settle = (status: RunStatus, reason?: string) => {
      if (cancelled || settled) return;
      flushSteps();
      settled = true;
      setLiveHeartbeat(null);
      setRunStatus(status, status === "failed" ? (reason ?? "unknown") : null);
      disconnect();
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const settleDone = (full: Job) => {
      if (cancelled || settled) return;
      setJob(full);
      setConsoleMode("evidence");
      settle("done");
    };

    disconnect = subscribeTrace(liveId, {
      onConnected: () => {
        if (useArgusStore.getState().runStatus === "connecting") {
          setRunStatus("running");
        }
      },
      onEvent: (ev) => {
        if (ev.kind === "step") {
          const agent = typeof ev.payload.agent === "string" ? ev.payload.agent : "";
          if (agent === "planner") {
            const n = ev.payload.n_claims;
            enqueueStage("parse", "Parse", "deterministic", "Parsed the input document", ev.sequence);
            enqueueStage(
              "planner",
              "Planner",
              "deepseek",
              `Extracted ${typeof n === "number" ? n : "?"} candidate claim(s)`,
              ev.sequence,
            );
          } else if (agent === "Consistency") {
            enqueueStage(
              "consistency",
              "Consistency",
              "deepseek",
              "Cross-checked the claims for internal contradictions",
              ev.sequence,
            );
          } else if (agent === "Reporter") {
            enqueueStage("reporter", "Reporter", "deepseek", "Synthesised the audit report", ev.sequence);
          } else {
            const step = stepFromPayload(ev.payload);
            if (step) enqueueStep(step);
          }
        } else if (ev.kind === "stage") {
          const stage = stageFromPayload(ev.payload);
          if (stage && stage.status === "finished") {
            enqueueStage(stage.key, stage.name, stage.engine, stage.summary, ev.sequence);
          }
        } else if (ev.kind === "claim") {
          const claim = claimFromPayload(ev.payload);
          if (claim && claim.status === "started") {
            enqueueStep(claimMarkerStep(claim, ev.sequence));
            setRunStatus("verifying");
          }
        } else if (ev.kind === "heartbeat") {
          const heartbeat = heartbeatFromPayload(ev.payload);
          if (heartbeat) setLiveHeartbeat(heartbeat);
        } else if (ev.kind === "atomized") {
          const p = ev.payload as { n_original?: number; n_atoms?: number };
          enqueueStage(
            "atomizer",
            "Atomizer",
            "deepseek",
            `Split ${p.n_original ?? "?"} claim(s) into ${p.n_atoms ?? "?"} atomic checks`,
            ev.sequence,
          );
        } else if (ev.kind === "filtered") {
          const p = ev.payload as { n_checkworthy?: number; n_filtered?: number };
          enqueueStage(
            "checkworthiness",
            "Check-worthiness",
            "deepseek",
            `Kept ${p.n_checkworthy ?? "?"} checkworthy, dropped ${p.n_filtered ?? "?"}`,
            ev.sequence,
          );
        } else if (ev.kind === "finding") {
          const f = findingFromPayload(ev.payload);
          if (f) appendLiveFinding(f);
        } else if (ev.kind === "finished") {
          getJob(liveId, requestOptions)
            .then((full) => settleDone(full))
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              settle("failed", `Could not load final job: ${msg}`);
            });
        } else if (ev.kind === "review_ready") {
          const claims = (ev.payload.claims ?? []) as ReviewClaim[];
          const filtered = (ev.payload.filtered ?? []) as FilteredClaim[];
          setReviewReady(claims, filtered);
          setLiveHeartbeat(null);
          enqueueStage(
            "review_gate",
            "Review gate",
            "deterministic",
            `${claims.length} claim(s) sent to verification`,
            ev.sequence,
          );
        } else if (ev.kind === "resumed") {
          setRunStatus("verifying");
        } else if (ev.kind === "failed") {
          const reason =
            typeof ev.payload.reason === "string" ? ev.payload.reason : "unknown";
          settle("failed", reason);
        }
      },
      onError: () => {},
      onGiveUp: () => {
        settle(
          "failed",
          "Lost connection to the live trace. The audit may still be running — refresh to check.",
        );
      },
    }, { accessToken: auth.accessToken });

    const poll = () => {
      getJob(liveId, requestOptions)
        .then((full) => {
          if (cancelled || settled) return;
          if (full.status === "done") {
            settleDone(full);
          } else if (full.status === "failed") {
            settle("failed", "The audit failed on the server.");
          }
        })
        .catch((err: unknown) => {
          if (cancelled || settled) return;
          if (err instanceof JobNotFoundError) {
            settle(
              "failed",
              `No audit with id "${liveId}" — it may have expired, or the URL is wrong.`,
            );
          }
        });
    };
    poll();
    pollTimer = setInterval(poll, 4000);

    return () => {
      cancelled = true;
      if (flushTimer !== null) clearTimeout(flushTimer);
      disconnect();
      if (pollTimer !== null) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveId, auth.configured, auth.loading, auth.accessToken]);
}
