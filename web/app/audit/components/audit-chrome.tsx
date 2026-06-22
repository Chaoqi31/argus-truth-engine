"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useArgusStore } from "@/lib/store";
import {
  buildShareUrl,
  createAuditShareLink,
} from "@/lib/account";

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0">
      <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.2 9.2L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function useCommandPaletteHotkey() {
  const setPaletteOpen = useArgusStore((s) => s.setPaletteOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);
}

export function PaletteHint() {
  const setPaletteOpen = useArgusStore((s) => s.setPaletteOpen);
  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      aria-label="Search findings (Command K)"
      className="group relative hidden items-center gap-2 overflow-hidden rounded-[10px] border border-[var(--cc-border)] bg-[var(--cc-bg)] px-3 py-1.5 text-[13px] text-[var(--cc-text-muted)] shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-primary/12 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 hover:border-[var(--cc-primary)] hover:text-[var(--cc-text)] hover:shadow-[0_14px_32px_rgba(16,24,40,0.11)] hover:before:translate-x-[430%] hover:before:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden sm:inline-flex"
    >
      <SearchIcon />
      <span className="relative min-w-[8.5rem] text-left">Search findings…</span>
      <kbd className="relative rounded border border-[var(--cc-border)] bg-[var(--cc-surface)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--cc-text-muted)] transition-[transform,border-color,color] duration-300 ease-enter group-hover:scale-105 group-hover:border-primary/40 group-hover:text-primary motion-reduce:transform-none">
        ⌘K
      </kbd>
    </button>
  );
}

export function SignedInNotice({ userLabel }: { userLabel: string | null }) {
  return (
    <div
      role="status"
      className="auth-toast-enter fixed right-6 top-16 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-[12px] border border-success/25 bg-background px-4 py-3 shadow-[0_18px_48px_rgba(16,24,40,0.16)]"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 inline-flex size-2.5 rounded-full bg-success ring-4 ring-success/15"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Signed in{userLabel ? ` as ${userLabel}` : ""}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Your personal center and audit history are now available.
          </p>
          <Link
            href="/app"
            className="mt-2 inline-flex text-xs font-semibold text-primary underline-offset-2 hover:underline"
          >
            Open personal center
          </Link>
        </div>
      </div>
    </div>
  );
}

export function getAuthUserLabel(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): string {
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  const name = user.user_metadata?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return user.email ?? "Your account";
}

export function ShareAuditButton({
  jobId,
  accessToken,
}: {
  jobId: string;
  accessToken: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const link = await createAuditShareLink(accessToken, jobId, 30);
      const url = buildShareUrl(link.token);
      setShareUrl(url);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={share}
        disabled={busy || !accessToken}
        className="group relative inline-flex items-center justify-center overflow-hidden rounded-[10px] border border-[var(--cc-border)] bg-[var(--cc-bg)] px-3 py-1.5 text-xs font-medium text-[var(--cc-text)] shadow-[var(--shadow-card)] transition-[transform,border-color,background-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-primary/12 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 hover:border-primary/35 hover:bg-background hover:text-primary hover:shadow-[0_14px_32px_rgba(16,24,40,0.11)] hover:before:translate-x-[430%] hover:before:opacity-100 disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden"
      >
        <span className="relative">{busy ? "Sharing..." : "Share"}</span>
      </button>
      {(shareUrl || error) && (
        <div className="auth-menu-enter absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-[12px] border border-border bg-background p-3 text-xs shadow-[0_18px_48px_rgba(16,24,40,0.16)]">
          {shareUrl ? (
            <>
              <p className="font-semibold text-success-foreground">Read-only link ready</p>
              <p className="mt-1 truncate font-mono text-muted-foreground">{shareUrl}</p>
            </>
          ) : (
            <p className="font-semibold text-destructive-foreground">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
