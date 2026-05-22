"use client";

import { useEffect, useState } from "react";

// BYOK input. The visitor pastes their own MiroMind API key; we persist it
// in localStorage so they don't have to re-enter on every reload, but the
// key never leaves the browser except on the audit POST (header) which goes
// straight to the Argus backend over HTTPS.

const STORAGE_KEY = "argus-miromind-key";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function ApiKeyInput({ value, onChange }: Props) {
  const [visible, setVisible] = useState(false);

  // Hydrate from localStorage on mount (parent owns the value).
  useEffect(() => {
    if (value) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) onChange(stored);
    } catch {
      /* private-mode browsers may throw — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (next: string) => {
    onChange(next);
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, next);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const id = "miromind-api-key";

  return (
    <div className="flex w-full max-w-md flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-center justify-between text-xs font-medium text-muted-foreground"
      >
        <span>Your MiroMind API key</span>
        <a
          href="https://miromind.ai/"
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-2 hover:underline"
        >
          Get one →
        </a>
      </label>
      <div className="flex items-stretch gap-1.5">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-…"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded-md border border-border bg-background px-3 text-xs text-muted-foreground hover:text-foreground"
          aria-label={visible ? "Hide key" : "Show key"}
          title={visible ? "Hide" : "Show"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Stored locally in your browser only. Sent to the Argus backend on each
        audit as <code className="font-mono">X-Miromind-Key</code>. The
        operator of this demo never sees it.
      </p>
    </div>
  );
}
