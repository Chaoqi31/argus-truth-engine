"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "auto";

const STORAGE_KEY = "argus-theme";

function readTheme(): Theme {
  if (typeof window === "undefined") return "auto";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  if (t === "light") {
    root.classList.add("theme-light");
    root.style.colorScheme = "light";
  } else if (t === "dark") {
    root.classList.add("theme-dark");
    root.style.colorScheme = "dark";
  } else {
    root.style.colorScheme = "";
  }
}

const ICONS: Record<Theme, string> = {
  light: "☀",
  dark: "☾",
  auto: "◐",
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const cycle = () => {
    const next: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Theme: ${theme}. Click to cycle.`}
      title={`Theme: ${theme}. Click to cycle.`}
    >
      <span aria-hidden>{ICONS[theme]}</span>
      {theme}
    </button>
  );
}
