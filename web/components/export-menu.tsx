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
        className="group relative overflow-hidden rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition-[transform,border-color,background-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-primary/12 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 hover:border-primary/35 hover:bg-background hover:text-primary hover:shadow-[0_14px_32px_rgba(16,24,40,0.11)] hover:before:translate-x-[430%] hover:before:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden"
      >
        <span className="relative">{label}</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="trace-panel-enter absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-border bg-background py-1 text-xs shadow-[0_18px_44px_rgba(16,24,40,0.14)]"
        >
          <button type="button" role="menuitem" onClick={() => choose("audit_pack")} className="block w-full px-3 py-1.5 text-left transition-[background-color,color,transform] duration-200 ease-enter hover:translate-x-0.5 hover:bg-primary/5 hover:text-primary motion-reduce:transform-none">Audit Pack</button>
          <button type="button" role="menuitem" onClick={() => choose("json")} className="block w-full px-3 py-1.5 text-left transition-[background-color,color,transform] duration-200 ease-enter hover:translate-x-0.5 hover:bg-primary/5 hover:text-primary motion-reduce:transform-none">Evidence Station</button>
          <button type="button" role="menuitem" onClick={() => choose("markdown")} className="block w-full px-3 py-1.5 text-left transition-[background-color,color,transform] duration-200 ease-enter hover:translate-x-0.5 hover:bg-primary/5 hover:text-primary motion-reduce:transform-none">Executive Markdown</button>
        </div>
      )}
    </div>
  );
}
