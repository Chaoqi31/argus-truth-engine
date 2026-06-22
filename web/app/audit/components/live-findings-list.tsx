"use client";

import { useState } from "react";
import type { LiveFinding } from "@/lib/types";

export function LiveFindingsList({
  findings,
  mode = "stacked",
}: {
  findings: LiveFinding[];
  mode?: "stacked" | "side";
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const listClass =
    mode === "side"
      ? "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
      : "flex max-h-[calc(30vh-2.25rem)] shrink-0 flex-col gap-2 overflow-y-auto p-3";
  if (findings.length === 0) {
    return (
      <p className="p-6 text-xs text-muted-foreground">
        Findings will appear here as agents finish each claim…
      </p>
    );
  }
  const sev = (s: LiveFinding["severity"]): string =>
    s === "critical"
      ? "border-[var(--cc-danger)]/40 bg-[var(--cc-danger)]/10"
      : s === "major"
        ? "border-[var(--cc-warn)]/40 bg-[var(--cc-warn)]/10"
        : "border-border bg-muted";
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <ul className={listClass}>
      {findings.map((f) => {
        const isOpen = expanded.has(f.id);
        return (
          <li
            key={f.id}
            className={`group overflow-hidden rounded-[var(--radius-card)] border ${sev(f.severity)} text-xs transition-[transform,border-color,box-shadow,background-color] duration-300 ease-enter hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_12px_30px_rgba(16,24,40,0.1)] motion-reduce:transform-none`}
          >
            <button
              type="button"
              onClick={() => toggle(f.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors duration-300 ease-enter hover:bg-background/45 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--cc-text)] transition-colors duration-300 ease-enter group-hover:text-primary">{f.verdict}</span>
              <span className="flex items-center gap-2 font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                {f.severity}
                <span
                  aria-hidden
                  className={`text-foreground/60 transition-transform duration-300 ease-enter motion-reduce:transform-none ${isOpen ? "rotate-90" : ""}`}
                >
                  ▸
                </span>
              </span>
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-enter ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
              <div className="min-h-0 overflow-hidden">
                <p className="px-3 pb-2 text-muted-foreground">
                  {f.summary}
                </p>
              </div>
            </div>
            {!isOpen && (
              <p className="line-clamp-2 px-3 pb-2 text-muted-foreground" title={f.summary}>
                {f.summary}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
