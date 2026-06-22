"use client";

import { type CSSProperties, useRef } from "react";
import type { ConsoleMode } from "@/lib/store";

export function ConsoleToggle({
  current,
  onChange,
}: {
  current: ConsoleMode;
  onChange: (m: ConsoleMode) => void;
}) {
  const opts: Array<{ key: ConsoleMode; label: string }> = [
    { key: "evidence", label: "Evidence" },
    { key: "trace", label: "Trace" },
  ];
  return (
    <div className="flex w-full gap-1 rounded-md bg-muted p-0.5 ring-1 ring-[var(--cc-border)]">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={current === o.key}
          className={`group relative min-h-9 flex-1 overflow-hidden rounded px-2.5 text-[11px] font-medium uppercase tracking-wider transition-[transform,background-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden ${
            current === o.key
              ? "bg-[var(--cc-primary)] text-white shadow-[var(--cc-glow)] hover:before:translate-x-[430%] hover:before:opacity-100"
              : "text-muted-foreground hover:bg-background hover:text-primary hover:shadow-[0_10px_26px_rgba(16,24,40,0.09)]"
          }`}
        >
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ColumnResizeHandle({
  anchor,
  position,
  ariaLabel,
  onDelta,
  onKeyStep,
}: {
  anchor: "left" | "right";
  position: string;
  ariaLabel: string;
  onDelta: (dx: number) => void;
  onKeyStep: (dir: 1 | -1) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastX.current;
    lastX.current = e.clientX;
    if (dx !== 0) onDelta(dx);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); onKeyStep(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onKeyStep(1); }
  };

  const centring = anchor === "left" ? "-translate-x-1/2" : "translate-x-1/2";
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      style={{ [anchor]: position, touchAction: "none" } as CSSProperties}
      className={`group absolute inset-y-0 z-20 hidden w-2 ${centring} cursor-col-resize lg:block focus-visible:outline-hidden`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--cc-border)] transition-colors group-hover:bg-primary group-focus-visible:bg-primary"
      />
    </div>
  );
}
