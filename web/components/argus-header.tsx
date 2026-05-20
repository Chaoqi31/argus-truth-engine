"use client";

import Link from "next/link";

interface Props {
  rightSlot?: React.ReactNode;
}

export function ArgusHeader({ rightSlot }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-background px-6 py-3">
      <Link href="/" className="flex items-center gap-2">
        <span aria-hidden className="text-lg">👁️‍🗨️</span>
        <span className="font-semibold tracking-tight">Argus</span>
      </Link>
      {rightSlot}
    </header>
  );
}
