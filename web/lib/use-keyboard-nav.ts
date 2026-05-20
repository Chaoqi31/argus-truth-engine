"use client";

import { useEffect } from "react";
import { useArgusStore } from "@/lib/store";

/**
 * Wire global keyboard shortcuts for the audit page.
 *
 *   j / ArrowDown  → next finding
 *   k / ArrowUp    → previous finding
 *   ?              → show shortcuts hint (consumer handles UI)
 *
 * Shortcuts are inert while typing into an input/textarea/contenteditable.
 */
export function useFindingKeyboardNav(onShortcutsToggle?: () => void): void {
  const job = useArgusStore((s) => s.job);
  const activeFindingId = useArgusStore((s) => s.activeFindingId);
  const setActiveFinding = useArgusStore((s) => s.setActiveFinding);

  useEffect(() => {
    if (!job) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const findings = job.findings;
      if (findings.length === 0) return;
      const idx = findings.findIndex((f) => f.id === activeFindingId);

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = findings[(idx + 1) % findings.length];
        if (next) setActiveFinding(next.id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = findings[(idx - 1 + findings.length) % findings.length];
        if (prev) setActiveFinding(prev.id);
      } else if (e.key === "?" && onShortcutsToggle) {
        e.preventDefault();
        onShortcutsToggle();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [job, activeFindingId, setActiveFinding, onShortcutsToggle]);
}
