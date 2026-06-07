"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuthSession } from "@/lib/use-auth-session";

interface AuthButtonProps {
  next?: string;
  signInLabel?: string;
}

export function AuthButton({ next = "/app", signInLabel = "Sign in" }: AuthButtonProps) {
  const auth = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (!auth.configured) return null;
  if (auth.loading) {
    return (
      <div
        aria-hidden
        className="h-8 w-28 animate-pulse rounded-[10px] border border-border bg-muted"
      />
    );
  }
  if (auth.user) {
    const label = getUserLabel(auth.user);
    const email = auth.user.email ?? label;
    const initials = getInitials(label);
    return (
      <div ref={menuRef} className="relative flex items-center gap-2">
        <Link
          href="/app"
          className="hidden rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-[transform,border-color,background-color,box-shadow,color] duration-300 ease-enter hover:-translate-y-0.5 hover:border-primary/35 hover:bg-muted hover:text-primary hover:shadow-[0_14px_32px_rgba(16,24,40,0.11)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none sm:inline-flex"
        >
          Personal center
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Account menu for ${label}`}
          title={email}
          className="group relative inline-flex max-w-[14rem] items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-2.5 text-left shadow-[var(--shadow-card)] transition-[transform,border-color,background-color,box-shadow] duration-300 ease-enter hover:-translate-y-0.5 hover:border-primary/35 hover:bg-muted hover:shadow-[0_14px_32px_rgba(16,24,40,0.11)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none"
        >
          <span className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
            {initials}
            <span className="auth-status-dot absolute -right-0.5 -top-0.5 size-2 rounded-full bg-success ring-2 ring-background" />
          </span>
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-success-foreground">
              Signed in
            </span>
            <span className="truncate text-xs font-semibold text-foreground">{label}</span>
          </span>
          <span
            aria-hidden
            className={`mb-0.5 size-1.5 border-b border-r border-muted-foreground transition-transform duration-300 ease-enter motion-reduce:transition-none ${menuOpen ? "rotate-[225deg]" : "rotate-45"}`}
          />
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Account actions"
            className="auth-menu-enter absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 overflow-hidden rounded-[12px] border border-border bg-background shadow-[0_18px_48px_rgba(16,24,40,0.16)]"
          >
            <div className="border-b border-border px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-success-foreground">
                Signed in
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground">{label}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <div className="p-1.5">
              <Link
                role="menuitem"
                href="/app"
                onClick={() => setMenuOpen(false)}
                className="block rounded-[9px] px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                Personal center
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  API keys and saved audits
                </span>
              </Link>
              <Link
                role="menuitem"
                href="/app#history"
                onClick={() => setMenuOpen(false)}
                className="block rounded-[9px] px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                Audit history
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Reopen previous audit runs
                </span>
              </Link>
              <button
                role="menuitem"
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await auth.signOut();
                    setMenuOpen(false);
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
                className="mt-1 w-full rounded-[9px] px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {busy ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => auth.signIn(next)}
      className="group relative inline-flex items-center justify-center overflow-hidden rounded-[10px] bg-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_8px_22px_rgba(113,50,245,0.22)] transition-[transform,background-color,box-shadow] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-white/35 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 hover:bg-[#5741d8] hover:shadow-[0_14px_34px_rgba(113,50,245,0.30)] hover:before:translate-x-[430%] hover:before:opacity-100 active:translate-y-0 active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden"
    >
      <span className="relative">{signInLabel}</span>
    </button>
  );
}

function getUserLabel(user: NonNullable<ReturnType<typeof useAuthSession>["user"]>): string {
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  const name = user.user_metadata?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return user.email ?? "Your account";
}

function getInitials(label: string): string {
  const words = label
    .replace(/@.*/, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "A";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}
