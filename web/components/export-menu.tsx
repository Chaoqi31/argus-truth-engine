"use client";

import { useState } from "react";

export type ExportFormat = "pdf" | "json" | "markdown";

interface Props {
  onSelect: (format: ExportFormat) => void;
  disabled: boolean;
}

export function ExportMenu({ onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const choose = (f: ExportFormat) => {
    setOpen(false);
    onSelect(f);
  };
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted disabled:opacity-50"
      >
        Export ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-36 rounded-md border border-border bg-background py-1 text-xs shadow-lg">
          <button role="menuitem" onClick={() => choose("pdf")} className="block w-full px-3 py-1.5 text-left hover:bg-muted">PDF audit report</button>
          <button role="menuitem" onClick={() => choose("json")} className="block w-full px-3 py-1.5 text-left hover:bg-muted">JSON findings</button>
          <button role="menuitem" onClick={() => choose("markdown")} className="block w-full px-3 py-1.5 text-left hover:bg-muted">Markdown summary</button>
        </div>
      )}
    </div>
  );
}
