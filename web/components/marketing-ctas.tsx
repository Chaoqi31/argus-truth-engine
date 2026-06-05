"use client";

import Link from "next/link";
import { useArgusStore } from "@/lib/store";

interface Props {
  className?: string;
}

const PRIMARY =
  "group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-[12px] bg-primary px-8 py-3.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(113,50,245,0.24)] transition-[transform,background-color,box-shadow] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-8 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-white/35 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-1 hover:scale-[1.02] hover:bg-[#5741d8] hover:shadow-[0_18px_42px_rgba(113,50,245,0.34)] hover:before:translate-x-[430%] hover:before:opacity-100 active:translate-y-0 active:scale-[0.985] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden";

const SECONDARY =
  "group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-[12px] border border-border bg-background px-8 py-3.5 text-sm font-medium text-foreground shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-8 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-primary/12 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-1 hover:scale-[1.02] hover:border-primary/35 hover:text-primary hover:shadow-[0_16px_38px_rgba(16,24,40,0.11)] hover:before:translate-x-[430%] hover:before:opacity-100 active:translate-y-0 active:scale-[0.985] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden";

export function MarketingCtas({ className = "" }: Props) {
  const clearStore = useArgusStore((s) => s.clear);

  return (
    <div className={`flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4 ${className}`}>
      <Link href="/audit" onClick={clearStore} className={PRIMARY}>
        Start auditing
      </Link>
      <Link href="/audit?demo=1" onClick={clearStore} className={SECONDARY}>
        See a sample audit
      </Link>
    </div>
  );
}
