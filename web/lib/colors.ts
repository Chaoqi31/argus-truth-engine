import type { FindingVerdict, Severity, StepType } from "@/lib/types";

export const severityClass: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive ring-destructive/40",
  major: "bg-warning/15 text-warning ring-warning/40",
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
  uncertain: "muted",
};

export const stepIcon: Record<StepType, string> = {
  thinking: "💭",
  web_search: "🔍",
  fetch_url_content: "📄",
  execute_python: "🐍",
  execute_command: "⚡",
  tool_call: "🛠",
  message: "✅",
};
