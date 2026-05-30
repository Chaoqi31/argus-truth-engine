/**
 * Returns the URL only if it's an absolute http(s) URL; else null.
 * Safe to use as an href — blocks javascript:, data:, and relative paths.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
