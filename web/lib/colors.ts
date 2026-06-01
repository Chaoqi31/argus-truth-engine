import type { FindingVerdict, Severity, StepType } from "@/lib/types";

// Severity tints pair `text-{tone}-foreground` (darker) with `bg-{tone}/15`
// (lighter tint) so contrast passes WCAG AA in both light and dark mode.
export const severityClass: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive-foreground ring-destructive/40",
  major: "bg-warning/15 text-warning-foreground ring-warning/40",
  minor: "bg-muted text-muted-foreground ring-border",
};

export const verdictTone: Record<FindingVerdict, "danger" | "warn" | "ok" | "muted"> = {
  ok: "ok",
  fabricated: "danger",
  "partial-match": "warn",
  mismatch: "danger",
  misrepresented: "danger",
  stale: "warn",
  superseded: "warn",
  contradiction: "danger",
  inaccurate: "danger",
  outdated: "warn",
  uncertain: "muted",
  "unsupported-inference": "warn",
  overreach: "warn",
};

const TONE_COLOR_VAR: Record<"danger" | "warn" | "ok" | "muted", string> = {
  danger: "var(--cc-danger, #d92d20)",
  warn: "var(--cc-warn, #d18700)",
  ok: "var(--cc-ok, #149e61)",
  muted: "var(--cc-text-muted, #9497a9)",
};

export function verdictColorVar(verdict: FindingVerdict): string {
  return TONE_COLOR_VAR[verdictTone[verdict]];
}

export const stepIcon: Record<StepType, string> = {
  thinking: "💭",
  web_search: "🔍",
  fetch_url_content: "📄",
  execute_python: "🐍",
  execute_command: "⚡",
  tool_call: "🛠",
  message: "✅",
};
