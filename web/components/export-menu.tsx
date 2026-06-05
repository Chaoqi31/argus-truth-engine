"use client";

import { useEffect, useId, useState } from "react";

export type ExportFormat = "audit_pack" | "json" | "markdown";

interface Props {
  onSelect: (format: ExportFormat) => void | Promise<void>;
  disabled: boolean;
}

export function ExportMenu({ onSelect, disabled }: Props) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const choose = async (f: ExportFormat) => {
    setOpen(false);
    setStatus("working");
    try {
      await onSelect(f);
      setStatus("done");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("error");
    }
  };
  const label =
    status === "working"
      ? "Preparing…"
      : status === "done"
        ? "Exported"
        : status === "error"
          ? "Export failed"
          : "Export ▾";
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-live="polite"
        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted disabled:opacity-50"
      >
        {label}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 mt-1 w-48 rounded-md border border-border bg-background py-1 text-xs shadow-[var(--shadow-card)]"
        >
          <button type="button" role="menuitem" onClick={() => choose("audit_pack")} className="block w-full px-3 py-1.5 text-left hover:bg-muted">Audit Pack</button>
          <button type="button" role="menuitem" onClick={() => choose("json")} className="block w-full px-3 py-1.5 text-left hover:bg-muted">Evidence Station</button>
          <button type="button" role="menuitem" onClick={() => choose("markdown")} className="block w-full px-3 py-1.5 text-left hover:bg-muted">Executive Markdown</button>
        </div>
      )}
    </div>
  );
}
