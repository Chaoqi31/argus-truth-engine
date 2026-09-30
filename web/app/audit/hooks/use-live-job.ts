"use client";

import { useEffect } from "react";
import { getJob } from "@/lib/api";
import { watchJob } from "@/lib/job-socket";
import { applyFrame } from "@/lib/live-job";
import { useArgusStore } from "@/lib/store";

type AuthSlice = {
  configured: boolean;
  loading: boolean;
  accessToken: string | null;
};

/**
 * Watch a live audit. The socket opens with the whole job and then carries
 * every change to it, so the view never polls and a reconnect is
 * indistinguishable from a first load.
 */
export function useLiveJob(liveId: string | null, auth: AuthSlice) {
  const setJob = useArgusStore((s) => s.setJob);
  const applyJob = useArgusStore((s) => s.applyJob);
  const setRunStatus = useArgusStore((s) => s.setRunStatus);

  useEffect(() => {
    if (!liveId) return;
    if (auth.configured && auth.loading) return;
    setRunStatus("connecting");

    let cancelled = false;
    const stop = watchJob(
      liveId,
      {
        onSnapshot: (job) => {
          if (cancelled) return;
          // A fresh snapshot carries a real job with findings and reviews to
          // restore; frames after it only fold into it.
          if (useArgusStore.getState().job?.id === job.id) applyJob(job);
          else setJob(job);
        },
        onEvent: (frame) => {
          if (cancelled) return;
          const current = useArgusStore.getState().job;
          if (current === null) return;
          try {
            applyJob(applyFrame(current, frame));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setRunStatus("failed", `The live job stream fell out of step: ${message}`);
          }
        },
        onGiveUp: () => {
          if (cancelled) return;
          // No socket: the job is still readable, just no longer live.
          getJob(liveId, { accessToken: auth.accessToken })
            .then((job) => {
              if (cancelled) return;
              setJob(job);
              if (job.status === "running") {
                setRunStatus(
                  "failed",
                  "Lost the live stream. This audit may still be running — reload to follow it.",
                );
              }
            })
            .catch(() => {
              if (cancelled) return;
              setRunStatus(
                "failed",
                "Lost connection to the live audit. It may still be running — reload to check.",
              );
            });
        },
      },
      { accessToken: auth.accessToken },
    );

    return () => {
      cancelled = true;
      stop();
    };
  }, [liveId, auth.configured, auth.loading, auth.accessToken, setJob, applyJob, setRunStatus]);
}
