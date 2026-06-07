"use client";

import { useEffect, useState } from "react";

// BYOK input. The visitor pastes their own MiroMind API key; by default it
// stays only in component state for the current run. If they explicitly opt in
// to remembering it, we store it in localStorage for the review-resume path.

const STORAGE_KEY = "argus-miromind-key";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function ApiKeyInput({ value, onChange }: Props) {
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return Boolean(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return false;
    }
  });

  // Hydrate from localStorage on mount (parent owns the value).
  useEffect(() => {
    if (value) return;
    try {
      const sessionValue = window.sessionStorage.getItem(STORAGE_KEY);
      const localValue = window.localStorage.getItem(STORAGE_KEY);
      const stored = sessionValue ?? localValue;
      if (stored) {
        onChange(stored);
      }
    } catch {
      /* private-mode browsers may throw — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (next: string) => {
    onChange(next);
    try {
      if (next) window.sessionStorage.setItem(STORAGE_KEY, next);
      else window.sessionStorage.removeItem(STORAGE_KEY);
      if (remember && next) window.localStorage.setItem(STORAGE_KEY, next);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const handleRememberChange = (next: boolean) => {
    setRemember(next);
    try {
      if (next && value) window.localStorage.setItem(STORAGE_KEY, value);
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
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => handleRememberChange(e.target.checked)}
          className="size-3.5 rounded border-border"
        />
        <span>Remember key on this device for claim-review resume</span>
      </label>
    </div>
  );
}
