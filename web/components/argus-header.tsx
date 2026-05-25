"use client";

import Link from "next/link";
import { ArgusMark } from "@/components/argus-mark";

interface Props {
  rightSlot?: React.ReactNode;
}

export function ArgusHeader({ rightSlot }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-md">
      <div className="flex items-center">
        <Link href="/" className="group flex items-center gap-2.5">
          <ArgusMark className="text-primary transition-transform group-hover:rotate-[8deg]" />
          <span className="text-[15px] font-semibold tracking-tight">Argus</span>
        </Link>
        <nav className="ml-6 flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/for-teams" className="hover:text-foreground">For teams</Link>
        </nav>
      </div>
      {rightSlot}
    </header>
  );
}
