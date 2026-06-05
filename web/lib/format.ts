/** Shared formatting + id helpers used across the audit libs. */

export function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

/** Like `plural`, but the count is thousands-separated. */
export function noun(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : pluralLabel}`;
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function isMiroMindResponseId(id: string): boolean {
  return Boolean(id) && id !== "n/a" && !id.startsWith("deepseek:");
}
