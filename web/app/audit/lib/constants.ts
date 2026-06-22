export const DEMO_START_LINK =
  "group relative inline-flex items-center justify-center overflow-hidden rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-[transform,border-color,background-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-primary/12 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 hover:border-primary/35 hover:bg-background hover:text-primary hover:shadow-[0_14px_32px_rgba(16,24,40,0.11)] hover:before:translate-x-[430%] hover:before:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden";

export const COCKPIT_DOC_MIN = 300;
export const COCKPIT_DOC_MAX = 560;
export const COCKPIT_DOC_DEFAULT = 520;
export const COCKPIT_CONSOLE_MIN = 340;
export const COCKPIT_CONSOLE_MAX = 760;
export const COCKPIT_CONSOLE_DEFAULT = 400;

export const clampPx = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function auditNextFromParams(paramsString: string): string {
  const clean = new URLSearchParams(paramsString);
  clean.delete("signedIn");
  const qs = clean.toString();
  return `/audit${qs ? `?${qs}` : ""}`;
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
