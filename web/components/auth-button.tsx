"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuthSession } from "@/lib/use-auth-session";

export function AuthButton() {
  const auth = useAuthSession();
  const [busy, setBusy] = useState(false);

  if (!auth.configured) return null;
  if (auth.loading) {
    return (
      <div
        aria-hidden
        className="h-8 w-24 animate-pulse rounded-[10px] border border-border bg-muted"
      />
    );
  }
  if (auth.user) {
    const label =
      auth.user.user_metadata?.full_name ??
      auth.user.email ??
      "Account";
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/app"
          className="hidden rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted sm:inline-flex"
        >
          Dashboard
        </Link>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            try {
              await auth.signOut();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          title={String(label)}
          className="max-w-[11rem] truncate rounded-[10px] bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {busy ? "Signing out..." : "Sign out"}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => auth.signIn("/app")}
      className="rounded-[10px] bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#5741d8]"
    >
      Sign in with Google
    </button>
  );
}
