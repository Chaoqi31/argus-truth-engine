"use client";

import Link from "next/link";
import { ArgusMark } from "@/components/argus-mark";
import { DemoVideoNavLink } from "@/components/demo-video-nav-link";

interface Props {
  rightSlot?: React.ReactNode;
}

export function ArgusHeader({ rightSlot }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-6">
      <div className="flex items-center">
        <Link href="/" className="group flex items-center gap-2.5">
          <ArgusMark className="text-primary transition-transform group-hover:rotate-[8deg]" />
          <span className="text-xl font-bold tracking-tight">Argus</span>
        </Link>
        <nav className="ml-6 flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/incidents" className="hover:text-foreground">Incidents</Link>
          <Link href="/miromind" className="hover:text-foreground">Powered by MiroMind</Link>
          <Link href="/for-teams" className="hover:text-foreground">For teams</Link>
          <DemoVideoNavLink />
        </nav>
      </div>
      {rightSlot}
    </header>
  );
}
