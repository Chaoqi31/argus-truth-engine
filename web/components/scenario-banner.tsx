"use client";

import { useState } from "react";

interface Props {
  label: string;
  persona: string;
}

export function ScenarioBanner({ label, persona }: Props) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="flex items-start gap-3 border-b border-border bg-primary-soft px-6 py-3 text-sm">
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        {persona}
      </span>
      <p className="flex-1 text-muted-foreground">{label}</p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        aria-label="Dismiss scenario banner"
      >
        Dismiss
      </button>
    </div>
  );
}
