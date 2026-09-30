"use client";

import { useEffect, useState } from "react";
import { isApiKeyRemembered, storeApiKey, storedApiKey } from "@/lib/byok";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function ApiKeyInput({ value, onChange }: Props) {
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(
    () => typeof window !== "undefined" && isApiKeyRemembered(),
  );

  // The parent owns the value; seed it once from the browser session.
  useEffect(() => {
    if (value) return;
    const stored = storedApiKey();
    if (stored) onChange(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (next: string) => {
    onChange(next);
    storeApiKey(next, remember);
  };

  const handleRememberChange = (next: boolean) => {
    setRemember(next);
    storeApiKey(value, next);
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
