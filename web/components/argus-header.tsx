"use client";

import Link from "next/link";
import { ArgusMark } from "@/components/argus-mark";

interface Props {
  rightSlot?: React.ReactNode;
}

export function ArgusHeader({ rightSlot }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-md">
      <Link href="/" className="group flex items-center gap-2.5">
        <ArgusMark className="text-primary transition-transform group-hover:rotate-[8deg]" />
        <span className="text-[15px] font-semibold tracking-tight">Argus</span>
      </Link>
      {rightSlot}
    </header>
  );
}
