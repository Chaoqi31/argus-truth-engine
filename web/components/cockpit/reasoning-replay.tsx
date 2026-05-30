"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useAnimate,
  useAnimationFrame,
  useReducedMotion,
} from "motion/react";
import { useArgusStore } from "@/lib/store";
import { stepIcon } from "@/lib/colors";
import type { CorrectedInfo, Finding, Job, Step, StepType } from "@/lib/types";

/**
 * Reasoning replay (T3 surface) — the demo 1:30–2:30 centerpiece.
 *
 * A near-fullscreen dark "theater" that plays one finding's reasoning trace as
 * a cinematic, staged timeline: native MiroMind events revealed step-by-step
 * (thinking → web_search → fetch_url_content → verdict), with play/pause and a
 * draggable scrubber that can land on any step.
 *
 * Contract (unchanged from the foundation stub):
 *   - reads `replayOpen` (boolean) — `true` shows the overlay.
 *   - reads `replayFindingId` to pick the finding whose trace plays
 *     (null → falls back to the longest trace, else live steps).
 *   - close via `setReplayOpen(false)` (Esc / backdrop / button).
 *
 * Motion: `motion` only (no gsap). Honors prefers-reduced-motion — when
 * reduced, the whole trace is shown statically with no autoplay.
 */
export function ReasoningReplay() {
  const replayOpen = useArgusStore((s) => s.replayOpen);
  const replayFindingId = useArgusStore((s) => s.replayFindingId);
  const setReplayOpen = useArgusStore((s) => s.setReplayOpen);
  const job = useArgusStore((s) => s.job);
  const liveSteps = useArgusStore((s) => s.liveSteps);

  const close = useCallback(() => setReplayOpen(false), [setReplayOpen]);

  const { finding, steps } = useMemo(
    () => resolveTrace(job, replayFindingId, liveSteps),
    [job, replayFindingId, liveSteps],
  );

  return (
    <AnimatePresence>
      {replayOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Reasoning replay"
          className="cc-backdrop fixed inset-0 z-50 flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          tabIndex={-1}
        >
          {/* Backdrop click-to-close — sits behind the stage chrome. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 -z-10 cursor-default"
          />
          <Theater
            key={finding?.id ?? steps[0]?.trace_id ?? "empty"}
            finding={finding}
            steps={steps}
            onClose={close}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// --- trace resolution -------------------------------------------------------

interface ResolvedTrace {
  finding: Finding | null;
  steps: Step[];
}

/**
 * Pick the steps to replay:
 *   1. the finding's own trace (replayFindingId → finding.reasoning_trace_id),
 *   2. else the longest trace in the job,
 *   3. else the live step stream.
 * Steps are always returned ordered by sequence.
 */
function resolveTrace(
  job: Job | null,
  findingId: string | null,
  liveSteps: Step[],
): ResolvedTrace {
  const bySeq = (s: Step[]) => [...s].sort((a, b) => a.sequence - b.sequence);

  const finding = job?.findings.find((f) => f.id === findingId) ?? null;

  if (finding && job) {
    const trace = job.traces.find((t) => t.id === finding.reasoning_trace_id);
    if (trace && trace.steps.length > 0) {
      return { finding, steps: bySeq(trace.steps) };
    }
  }

  if (job && job.traces.length > 0) {
    const longest = job.traces.reduce((best, t) =>
      t.steps.length > best.steps.length ? t : best,
    );
    if (longest.steps.length > 0) {
      const owner =
        job.findings.find((f) => f.reasoning_trace_id === longest.id) ?? finding;
      return { finding: owner, steps: bySeq(longest.steps) };
    }
  }

  return { finding, steps: bySeq(liveSteps) };
}

// --- playback timing --------------------------------------------------------

/**
 * Per-step "dwell" weights (ms) — mirror MiroMind's SSE rhythm so playback
 * feels like the live stream. Heavier steps (search/fetch) linger longer.
 * Kept local to avoid importing the live replayer (different concern).
 */
const STEP_DWELL: Record<StepType, number> = {
  thinking: 1300,
  message: 1700,
  tool_call: 1500,
  execute_python: 1900,
  execute_command: 1900,
  web_search: 2100,
  fetch_url_content: 2400,
};

const SPEEDS = [0.5, 1, 1.5, 2] as const;

const STEP_LABEL: Record<StepType, string> = {
  thinking: "Thinking",
  web_search: "Web search",
  fetch_url_content: "Fetch URL",
  execute_python: "Execute Python",
  execute_command: "Execute command",
  tool_call: "Tool call",
  message: "Conclusion",
};

// --- theater ----------------------------------------------------------------

function Theater({
  finding,
  steps,
  onClose,
}: {
  finding: Finding | null;
  steps: Step[];
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const n = steps.length;

  // Cumulative timeline: weight[i] = ms to dwell on step i; bounds in [0,1].
  const { totalMs, bounds } = useMemo(() => {
    const weights = steps.map((s) => STEP_DWELL[s.type] ?? 1500);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const edges: number[] = [0];
    let acc = 0;
    for (const w of weights) {
      acc += w;
      edges.push(acc / total);
    }
    return { totalMs: total, bounds: edges }; // bounds.length === n + 1
  }, [steps]);

  // progress 0..1 is the single source of truth; held in a ref so the rAF loop
  // doesn't churn React state, mirrored to `pct` for rendering.
  const progressRef = useRef(reduceMotion ? 1 : 0);
  const [pct, setPct] = useState(progressRef.current);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1); // default 1x
  const scrubbingRef = useRef(false);

  const indexFor = useCallback(
    (p: number) => {
      if (n === 0) return 0;
      // Largest i such that bounds[i] <= p; clamp to last step.
      let i = 0;
      while (i < n && bounds[i + 1] <= p) i++;
      return Math.min(i, n - 1);
    },
    [bounds, n],
  );

  const activeIndex = indexFor(pct);
  const atEnd = pct >= 1 - 1e-4;
  const speed = SPEEDS[speedIdx] ?? 1;

  // Autoplay on open (unless reduced motion or an empty trace).
  useEffect(() => {
    if (reduceMotion || n === 0) return;
    progressRef.current = 0;
    setPct(0);
    const t = setTimeout(() => setPlaying(true), 360);
    return () => clearTimeout(t);
  }, [reduceMotion, n]);

  // rAF advance loop. delta is wall-clock; convert to fraction via totalMs.
  useAnimationFrame((_, delta) => {
    if (!playing || reduceMotion || scrubbingRef.current || n === 0) return;
    const next = Math.min(1, progressRef.current + (delta * speed) / totalMs);
    progressRef.current = next;
    setPct(next);
    if (next >= 1) setPlaying(false);
  });

  const setProgress = useCallback((p: number) => {
    const clamped = Math.max(0, Math.min(1, p));
    progressRef.current = clamped;
    setPct(clamped);
  }, []);

  const togglePlay = useCallback(() => {
    if (n === 0) return;
    setPlaying((prev) => {
      if (!prev && progressRef.current >= 1 - 1e-4) setProgress(0); // restart
      return !prev;
    });
  }, [n, setProgress]);

  const restart = useCallback(() => {
    setProgress(0);
    if (!reduceMotion && n > 0) setPlaying(true);
  }, [reduceMotion, n, setProgress]);

  const stepTo = useCallback(
    (dir: -1 | 1) => {
      setPlaying(false);
      const target = activeIndex + dir;
      if (target < 0 || target > n - 1) return;
      // Land at the *start* of the target step's window (+ epsilon).
      setProgress(bounds[target] + 1e-4);
    },
    [activeIndex, bounds, n, setProgress],
  );

  // Keyboard transport. Captured at the theater root.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepTo(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepTo(-1);
      }
    },
    [togglePlay, stepTo],
  );

  if (n === 0) {
    return <EmptyState finding={finding} onClose={onClose} />;
  }

  const verdict = finding?.verdict ?? null;
  const tone = verdict ? verdictTone(verdict) : "muted";
  const verdictRevealed = atEnd || activeIndex >= n - 1;

  // Focus the root so space/arrow transport works without a click first.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <motion.div
      ref={rootRef}
      className="relative flex h-full w-full flex-col outline-hidden"
      tabIndex={-1}
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.04 }}
      onKeyDown={onKeyDown}
    >
      <Header finding={finding} onClose={onClose} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-3 pt-4 md:flex-row md:gap-6 md:px-8 md:pt-6">
        {/* Left rail — the timeline. */}
        <Timeline
          steps={steps}
          activeIndex={activeIndex}
          onSelect={(i) => {
            setPlaying(false);
            setProgress(bounds[i] + 1e-4);
          }}
        />

        {/* Center stage — the focused current step. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <Stage
            step={steps[activeIndex]}
            index={activeIndex}
            total={n}
            reduceMotion={reduceMotion}
            showVerdict={verdictRevealed}
            verdict={verdict}
            tone={tone}
            finding={finding}
          />
        </div>
      </div>

      <Transport
        pct={pct}
        bounds={bounds}
        steps={steps}
        activeIndex={activeIndex}
        playing={playing}
        atEnd={atEnd}
        reduceMotion={reduceMotion}
        speed={speed}
        verdict={verdict}
        tone={tone}
        onToggle={togglePlay}
        onRestart={restart}
        onCycleSpeed={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
        onScrub={setProgress}
        onScrubStart={() => {
          scrubbingRef.current = true;
          setPlaying(false);
        }}
        onScrubEnd={() => {
          scrubbingRef.current = false;
        }}
      />
    </motion.div>
  );
}

// --- header -----------------------------------------------------------------

function Header({
  finding,
  onClose,
}: {
  finding: Finding | null;
  onClose: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-[var(--cc-border)] px-4 py-3.5 md:px-8">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="size-2 rounded-full bg-[var(--cc-primary-bright)]"
          style={{ boxShadow: "var(--cc-glow)" }}
        />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
            Reasoning replay
          </p>
          <p className="text-sm font-medium text-[var(--cc-text)]">
            {finding ? (
              <>
                {finding.agent}
                <span className="text-[var(--cc-text-muted)]"> · </span>
                <span className="font-mono uppercase tracking-wide">
                  {finding.verdict}
                </span>
              </>
            ) : (
              "Full audit timeline"
            )}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close replay"
        className="rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--cc-text-muted)] transition-colors hover:bg-[var(--cc-bg)] hover:text-[var(--cc-text)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
      >
        Esc · Close
      </button>
    </header>
  );
}

// --- timeline (left rail) ---------------------------------------------------

function Timeline({
  steps,
  activeIndex,
  onSelect,
}: {
  steps: Step[];
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  const listRef = useRef<HTMLOListElement | null>(null);

  // Keep the active node in view as playback advances.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-step-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <nav
      aria-label="Reasoning steps"
      className="cc-glass hidden w-[clamp(15rem,24vw,20rem)] shrink-0 overflow-hidden rounded-xl md:block"
    >
      <div className="border-b border-[var(--cc-border)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
          Trace · {steps.length} steps
        </p>
      </div>
      <ol
        ref={listRef}
        className="flex max-h-full flex-col gap-0.5 overflow-y-auto px-2 py-2"
      >
        {steps.map((s, i) => {
          const state = i < activeIndex ? "past" : i === activeIndex ? "active" : "future";
          return (
            <li key={s.id} data-step-idx={i}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={state === "active"}
                className="group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--cc-bg)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
              >
                <TimelineNode state={state} type={s.type} />
                <span className="min-w-0 flex-1">
                  <span
                    className="block font-mono text-[10px] uppercase tracking-wider"
                    style={{
                      color:
                        state === "future"
                          ? "var(--cc-text-muted)"
                          : "var(--cc-primary-bright)",
                      opacity: state === "future" ? 0.6 : 1,
                    }}
                  >
                    {STEP_LABEL[s.type] ?? s.type}
                  </span>
                  <span
                    className="mt-0.5 block truncate text-xs"
                    style={{
                      color:
                        state === "active"
                          ? "var(--cc-text)"
                          : "var(--cc-text-muted)",
                      opacity: state === "future" ? 0.55 : 1,
                    }}
                  >
                    {cleanSummary(s)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function TimelineNode({
  state,
  type,
}: {
  state: "past" | "active" | "future";
  type: StepType;
}) {
  const reduceMotion = useReducedMotion() ?? false;

  // Active node: a glowing icon chip with a spring "pop" on becoming active and
  // an outward sonar-ping behind it. Past/future stay as quiet dots.
  if (state === "active") {
    return (
      <span aria-hidden className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
        {/* Sonar-ping halo — outward-rippling, fades. Decorative overlay. */}
        {!reduceMotion && (
          <span
            className="cc-pulse-glow pointer-events-none absolute inset-0 rounded-full"
            style={{ backgroundColor: "color-mix(in oklab, var(--cc-primary) 38%, transparent)" }}
          />
        )}
        {/* Glowing icon chip — springs to scale 1.2 then settles to 1.0. */}
        <motion.span
          key={type}
          initial={reduceMotion ? false : { scale: 0.7 }}
          animate={{ scale: reduceMotion ? 1 : [1.2, 1] }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 520, damping: 18, mass: 0.6 }
          }
          className="relative grid size-5 place-items-center rounded-full text-[10px] leading-none"
          style={{
            backgroundColor: "color-mix(in oklab, var(--cc-primary) 18%, transparent)",
            border: "1px solid var(--cc-border-glow)",
            boxShadow: "var(--cc-glow-hover)",
          }}
        >
          {stepIcon[type] ?? "•"}
        </motion.span>
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="mt-1.5 size-2.5 shrink-0 rounded-full transition-all duration-300"
      style={
        state === "past"
          ? { backgroundColor: "var(--cc-primary)", opacity: 0.85 }
          : { backgroundColor: "var(--cc-text-muted)", opacity: 0.35 }
      }
    />
  );
}

// --- center stage -----------------------------------------------------------

function Stage({
  step,
  index,
  total,
  reduceMotion,
  showVerdict,
  verdict,
  tone,
  finding,
}: {
  step: Step | undefined;
  index: number;
  total: number;
  reduceMotion: boolean;
  showVerdict: boolean;
  verdict: string | null;
  tone: Tone;
  finding: Finding | null;
}) {
  const [scope, animate] = useAnimate();

  // Staged reveal each time the active step changes.
  useEffect(() => {
    if (!scope.current || reduceMotion) return;
    animate(
      scope.current,
      { opacity: [0, 1], y: [14, 0], filter: ["blur(8px)", "blur(0px)"] },
      { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
    );
  }, [index, scope, animate, reduceMotion]);

  if (!step) return null;

  const icon = stepIcon[step.type] ?? "•";
  const isVerdictStep = showVerdict && (step.type === "message" || index === total - 1);

  return (
    <div
      ref={scope}
      className="cc-glass relative flex w-full max-w-2xl flex-col gap-5 rounded-2xl px-7 py-8 md:px-9 md:py-10"
      style={{ boxShadow: "var(--shadow-card-hover)" }}
    >
      {/* top: native event type + position */}
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-lg text-base"
            style={{
              backgroundColor: "rgba(113,50,245,0.14)",
              border: "1px solid var(--cc-border-glow)",
            }}
          >
            {icon}
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--cc-primary-bright)]">
            {STEP_LABEL[step.type] ?? step.type}
          </span>
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[var(--cc-text-muted)]">
          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>

      {/* body: emphasize search query / fetched URL like the live trace view */}
      <StageBody step={step} />

      {/* verdict reveal on the final step */}
      <AnimatePresence>
        {isVerdictStep && verdict && (
          <VerdictReveal
            verdict={verdict}
            tone={tone}
            finding={finding}
            reduceMotion={reduceMotion}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StageBody({ step }: { step: Step }) {
  const summary = cleanSummary(step);

  if (step.type === "web_search") {
    return (
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-wider text-[var(--cc-text-muted)]">
          query
        </span>
        <p className="text-xl font-medium leading-snug text-[var(--cc-text)] md:text-2xl">
          {summary}
        </p>
      </div>
    );
  }

  if (step.type === "fetch_url_content") {
    return (
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-wider text-[var(--cc-text-muted)]">
          source
        </span>
        <p className="break-words font-mono text-lg leading-snug text-[var(--cc-primary-bright)] md:text-xl">
          {summary}
        </p>
      </div>
    );
  }

  if (step.type === "thinking") {
    const thought =
      typeof step.content?.thought === "string" ? step.content.thought : null;
    return <ThinkingTypewriter text={thought ?? summary} isFallback={!thought} />;
  }

  // message / tool_call / execute_* — render as the agent's note.
  return (
    <p className="text-xl leading-relaxed text-[var(--cc-text)] md:text-2xl">
      {summary}
    </p>
  );
}

/**
 * Renders thinking content as a monospace dark-panel typewriter.
 * Honors prefers-reduced-motion: when reduced, shows the full text immediately.
 * Speed is calibrated to STEP_DWELL.thinking (1300 ms) so the text flows
 * within the step's natural dwell window at a comfortable reading pace.
 */
function ThinkingTypewriter({
  text,
  isFallback,
}: {
  text: string;
  isFallback: boolean;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  // idxRef drives the visible slice; displayed mirrors it for renders.
  const idxRef = useRef(reduceMotion ? text.length : 0);
  const [displayed, setDisplayed] = useState(() =>
    reduceMotion ? text : "",
  );

  useEffect(() => {
    // When text/reduceMotion changes, reset the cursor and kick off a new interval.
    idxRef.current = reduceMotion ? text.length : 0;

    if (reduceMotion) {
      // All updates happen inside the timer callback — defer even this reset.
      const id = setTimeout(() => setDisplayed(text), 0);
      return () => clearTimeout(id);
    }

    // Target: finish in ~1 200 ms (within STEP_DWELL.thinking=1300 ms).
    const tickMs = 22; // ~45 fps
    const charsPerTick = Math.max(1, Math.ceil(text.length / (1200 / tickMs)));

    const id = setInterval(() => {
      idxRef.current = Math.min(idxRef.current + charsPerTick, text.length);
      const slice = text.slice(0, idxRef.current);
      setDisplayed(slice);
      if (idxRef.current >= text.length) clearInterval(id);
    }, tickMs);

    return () => clearInterval(id);
  }, [text, reduceMotion]);

  return (
    <div
      className="relative flex flex-col gap-2 overflow-hidden rounded-lg"
      style={{ backgroundColor: "#101114" }}
    >
      {/* terminal chrome bar */}
      <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-4 py-2.5">
        <span aria-hidden className="size-2.5 rounded-full bg-[#ff5f57] opacity-70" />
        <span aria-hidden className="size-2.5 rounded-full bg-[#febc2e] opacity-70" />
        <span aria-hidden className="size-2.5 rounded-full bg-[#28c840] opacity-70" />
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
          {isFallback ? "thinking" : "thought stream"}
        </span>
      </div>
      {/* text area */}
      <pre
        className="max-h-[22rem] overflow-y-auto whitespace-pre-wrap break-words px-4 pb-4 font-mono text-sm leading-relaxed"
        style={{ color: "rgba(180,185,210,0.92)" }}
      >
        {displayed}
        {/* blinking cursor */}
        {!reduceMotion && displayed.length < text.length && (
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 0] }}
            transition={{ repeat: Infinity, duration: 0.6, ease: "linear" }}
            className="inline-block h-[1em] w-[2px] translate-y-[2px] bg-[var(--cc-primary-bright)]"
          />
        )}
      </pre>
    </div>
  );
}

/**
 * Staggered verdict reveal — the cinematic climax of the replay.
 * Sections appear in sequence: verdict badge → confidence counter →
 * reasoning sentence → why_wrong → correct_information.
 */
function VerdictReveal({
  verdict,
  tone,
  finding,
  reduceMotion,
}: {
  verdict: string;
  tone: Tone;
  finding: Finding | null;
  reduceMotion: boolean;
}) {
  const confidenceTarget = finding ? Math.round(finding.confidence * 100) : null;
  // startRef tracks when this VerdictReveal mounted (or target changed).
  const countStartRef = useRef<number | null>(null);
  const [confidenceDisplayed, setConfidenceDisplayed] = useState(() =>
    reduceMotion ? (confidenceTarget ?? 0) : 0,
  );

  // Count up the confidence figure via rAF — no synchronous setState in body.
  useEffect(() => {
    if (reduceMotion || confidenceTarget === null) return;
    countStartRef.current = null; // reset; rAF will capture real start time
    const duration = 700; // ms
    let frame: number;
    const tick = (now: number) => {
      if (countStartRef.current === null) countStartRef.current = now;
      const elapsed = now - countStartRef.current;
      const t = Math.min(1, elapsed / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setConfidenceDisplayed(Math.round(eased * confidenceTarget));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [confidenceTarget, reduceMotion]);

  const reasoningText = finding?.confidence_breakdown?.reasoning ?? null;
  const whyWrong = finding?.why_wrong ?? null;
  const correctInfo: CorrectedInfo | null = finding?.correct_information ?? null;

  const stagger = (i: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.38,
            ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
            delay: i * 0.14,
          },
        };

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: reduceMotion ? 0 : 0.12 }}
      className="mt-1 flex flex-col gap-4 border-t border-[var(--cc-border)] pt-5"
    >
      {/* 1 — Verdict badge */}
      <motion.div className="flex flex-col gap-2" {...stagger(0)}>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
          Verdict
        </span>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="size-3 rounded-full"
            style={{
              backgroundColor: toneColor(tone),
              boxShadow: `0 0 10px 2px ${toneColor(tone)}55`,
            }}
          />
          <span
            className="text-2xl font-semibold tracking-tight md:text-3xl"
            style={{ color: toneColor(tone) }}
          >
            {verdict.toUpperCase()}
          </span>
        </div>
        {finding?.summary && (
          <p className="text-sm leading-relaxed text-[var(--cc-text-muted)]">
            {finding.summary}
          </p>
        )}
      </motion.div>

      {/* 2 — Confidence counter */}
      {confidenceTarget !== null && (
        <motion.div className="flex items-baseline gap-2" {...stagger(1)}>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
            Confidence
          </span>
          <span
            className="font-mono text-lg font-semibold tabular-nums"
            style={{ color: toneColor(tone) }}
          >
            {confidenceDisplayed}%
          </span>
        </motion.div>
      )}

      {/* 3 — Reasoning sentence */}
      {reasoningText && (
        <motion.div className="flex flex-col gap-1" {...stagger(2)}>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
            Confidence reasoning
          </span>
          <p className="text-sm leading-relaxed text-[var(--cc-text-muted)]">
            {reasoningText}
          </p>
        </motion.div>
      )}

      {/* 4 — Why wrong */}
      {whyWrong && (
        <motion.div
          className="flex flex-col gap-1 rounded-lg px-4 py-3"
          style={{ backgroundColor: toneTint(tone), border: `1px solid ${toneBorder(tone)}` }}
          {...stagger(3)}
        >
          <span
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: toneColor(tone) }}
          >
            Why it&apos;s wrong
          </span>
          <p className="text-sm leading-relaxed" style={{ color: toneColor(tone) }}>
            {whyWrong}
          </p>
        </motion.div>
      )}

      {/* 5 — Correct information */}
      {correctInfo && (
        <motion.div
          className="flex flex-col gap-1 rounded-lg border border-[var(--cc-border)] px-4 py-3"
          style={{ backgroundColor: "color-mix(in oklab, var(--cc-primary) 6%, transparent)" }}
          {...stagger(4)}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--cc-primary-bright)]">
            Correct information
          </span>
          <p className="text-sm leading-relaxed text-[var(--cc-text)]">
            {correctInfo.value}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--cc-text-muted)]">
            Source:{" "}
            {correctInfo.url ? (
              <a
                href={correctInfo.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--cc-primary-bright)] underline underline-offset-2 hover:text-[var(--cc-primary)]"
              >
                {correctInfo.source}
              </a>
            ) : (
              <span>{correctInfo.source}</span>
            )}
            {correctInfo.retrieved_date && (
              <span className="ml-2 opacity-60">· {correctInfo.retrieved_date}</span>
            )}
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}

// --- transport (bottom bar + scrubber) --------------------------------------

function Transport({
  pct,
  bounds,
  steps,
  activeIndex,
  playing,
  atEnd,
  reduceMotion,
  speed,
  verdict,
  tone,
  onToggle,
  onRestart,
  onCycleSpeed,
  onScrub,
  onScrubStart,
  onScrubEnd,
}: {
  pct: number;
  bounds: number[];
  steps: Step[];
  activeIndex: number;
  playing: boolean;
  atEnd: boolean;
  reduceMotion: boolean;
  speed: number;
  verdict: string | null;
  tone: Tone;
  onToggle: () => void;
  onRestart: () => void;
  onCycleSpeed: () => void;
  onScrub: (p: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const total = steps.length;

  return (
    <div className="border-t border-[var(--cc-border)] px-4 py-4 md:px-8">
      <Scrubber
        pct={pct}
        bounds={bounds}
        steps={steps}
        activeIndex={activeIndex}
        reduceMotion={reduceMotion}
        onScrub={onScrub}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? "Pause" : atEnd ? "Replay" : "Play"}
            className="grid size-11 place-items-center rounded-full text-[var(--cc-text)] transition-all hover:brightness-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
            style={{
              background:
                "linear-gradient(180deg, var(--cc-primary-bright), var(--cc-primary))",
              boxShadow: "var(--cc-glow)",
            }}
          >
            {playing ? <PauseIcon /> : atEnd ? <RestartIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            onClick={onRestart}
            aria-label="Restart from first step"
            className="grid size-9 place-items-center rounded-full text-[var(--cc-text-muted)] transition-colors hover:bg-[var(--cc-bg)] hover:text-[var(--cc-text)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)]"
          >
            <RestartIcon />
          </button>
          <button
            type="button"
            onClick={onCycleSpeed}
            aria-label={`Playback speed ${speed}×`}
            disabled={reduceMotion}
            className="ml-1 rounded-md px-2.5 py-1.5 font-mono text-xs tabular-nums text-[var(--cc-text-muted)] transition-colors hover:bg-[var(--cc-bg)] hover:text-[var(--cc-text)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--cc-primary)] disabled:opacity-40"
          >
            {speed}×
          </button>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-mono text-xs tabular-nums text-[var(--cc-text-muted)]">
            {String(Math.min(activeIndex + 1, total)).padStart(2, "0")}
            <span className="opacity-50"> / {String(total).padStart(2, "0")}</span>
          </span>
          {verdict && (
            <span
              className="hidden items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider sm:inline-flex"
              style={{
                color: toneColor(tone),
                backgroundColor: toneTint(tone),
                border: `1px solid ${toneBorder(tone)}`,
              }}
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ backgroundColor: toneColor(tone) }}
              />
              {verdict}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Scrubber({
  pct,
  bounds,
  steps,
  activeIndex,
  reduceMotion,
  onScrub,
  onScrubStart,
  onScrubEnd,
}: {
  pct: number;
  bounds: number[];
  steps: Step[];
  activeIndex: number;
  reduceMotion: boolean;
  onScrub: (p: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const posFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      onScrubStart();
      e.currentTarget.setPointerCapture(e.pointerId);
      onScrub(posFromClientX(e.clientX));
    },
    [onScrub, onScrubStart, posFromClientX],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      onScrub(posFromClientX(e.clientX));
    },
    [onScrub, posFromClientX],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be released
      }
      onScrubEnd();
    },
    [onScrubEnd],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const n = steps.length;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const t = Math.min(activeIndex + 1, n - 1);
        onScrub(bounds[t] + 1e-4);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const t = Math.max(activeIndex - 1, 0);
        onScrub(bounds[t] + 1e-4);
      } else if (e.key === "Home") {
        e.preventDefault();
        onScrub(0);
      } else if (e.key === "End") {
        e.preventDefault();
        onScrub(1);
      }
    },
    [activeIndex, bounds, onScrub, steps.length],
  );

  const fillPct = `${pct * 100}%`;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Reasoning timeline scrubber"
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuenow={activeIndex + 1}
      aria-valuetext={`Step ${activeIndex + 1} of ${steps.length}: ${STEP_LABEL[steps[activeIndex]?.type] ?? ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="group relative flex h-6 cursor-pointer touch-none items-center focus-visible:outline-hidden"
    >
      {/* track */}
      <div className="relative h-1.5 w-full rounded-full bg-[var(--cc-border)]">
        {/* fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: fillPct,
            background:
              "linear-gradient(90deg, var(--cc-primary), var(--cc-primary-bright))",
            transition: reduceMotion ? "none" : "width 80ms linear",
          }}
        />
        {/* per-step tick marks (skip 0 and the final edge) */}
        {bounds.slice(1, -1).map((b, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${b * 100}%`,
              backgroundColor:
                b <= pct ? "var(--cc-primary-bright)" : "var(--cc-border-strong, #c4c5d0)",
            }}
          />
        ))}
      </div>

      {/* thumb */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--cc-surface)] bg-[var(--cc-primary)] shadow-[var(--shadow-card)] transition-transform group-hover:scale-110 group-focus-visible:scale-110"
        style={{
          left: fillPct,
          boxShadow: "0 0 0 3px color-mix(in oklab, var(--cc-primary) 22%, transparent)",
          transition: reduceMotion ? "none" : "left 80ms linear",
        }}
      />
    </div>
  );
}

// --- empty state ------------------------------------------------------------

function EmptyState({
  finding,
  onClose,
}: {
  finding: Finding | null;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Header finding={finding} onClose={onClose} />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <span
          aria-hidden
          className="grid size-12 place-items-center rounded-xl text-xl"
          style={{
            backgroundColor: "rgba(113,50,245,0.12)",
            border: "1px solid var(--cc-border-glow)",
          }}
        >
          {stepIcon.thinking}
        </span>
        <p className="text-sm font-medium text-[var(--cc-text)]">
          No reasoning steps to replay
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-[var(--cc-text-muted)]">
          This finding has no recorded trace. Run a live audit to watch each
          search, fetch, and reasoning step stream in real time.
        </p>
      </div>
    </motion.div>
  );
}

// --- helpers ----------------------------------------------------------------

/** Strip the `search:` / `fetch:` prefixes the live view also removes. */
function cleanSummary(step: Step): string {
  if (step.type === "web_search") return step.summary.replace(/^search:\s*/i, "");
  if (step.type === "fetch_url_content") return step.summary.replace(/^fetch:\s*/i, "");
  return step.summary;
}

type Tone = "danger" | "warn" | "ok" | "muted";

/** Mirror of lib/colors.ts verdictTone, kept local to avoid a shared import. */
function verdictTone(verdict: string): Tone {
  switch (verdict) {
    case "ok":
      return "ok";
    case "fabricated":
    case "mismatch":
    case "misrepresented":
    case "contradiction":
      return "danger";
    case "partial-match":
    case "stale":
    case "superseded":
      return "warn";
    default:
      return "muted";
  }
}

function toneColor(tone: Tone): string {
  switch (tone) {
    case "danger":
      return "var(--cc-danger)";
    case "warn":
      return "var(--cc-warn)";
    case "ok":
      return "var(--cc-ok)";
    default:
      return "var(--cc-text-muted)";
  }
}

function toneTint(tone: Tone): string {
  switch (tone) {
    case "danger":
      return "rgba(255,92,108,0.12)";
    case "warn":
      return "rgba(255,184,77,0.12)";
    case "ok":
      return "rgba(46,230,160,0.12)";
    default:
      return "rgba(255,255,255,0.05)";
  }
}

function toneBorder(tone: Tone): string {
  switch (tone) {
    case "danger":
      return "rgba(255,92,108,0.35)";
    case "warn":
      return "rgba(255,184,77,0.35)";
    case "ok":
      return "rgba(46,230,160,0.35)";
    default:
      return "var(--cc-border)";
  }
}

// --- transport icons (inline, no deps) --------------------------------------

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4.5 3.2c0-.5.55-.82.99-.56l7.2 4.3a.65.65 0 0 1 0 1.12l-7.2 4.3a.65.65 0 0 1-.99-.56V3.2Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.7-3.98" />
      <path d="M4 2.5V5h2.5" />
    </svg>
  );
}
