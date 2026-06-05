"use client";

interface Props {
  onShowFullAudit: () => void;
  disabled?: boolean;
}

export function DemoRunControls({ onShowFullAudit, disabled = false }: Props) {
  return (
    <div className="hidden items-center gap-2 sm:flex">
      <button
        type="button"
        disabled={disabled}
        onClick={onShowFullAudit}
        className="group relative inline-flex min-h-9 items-center gap-1.5 overflow-hidden rounded-[10px] border border-[var(--cc-primary)] bg-background px-3 py-1.5 text-xs font-semibold text-[var(--cc-primary)] shadow-[var(--shadow-card)] transition-[transform,background-color,box-shadow,color] duration-300 ease-enter before:pointer-events-none before:absolute before:-inset-y-6 before:-left-1/2 before:w-1/3 before:rotate-12 before:bg-gradient-to-r before:from-transparent before:via-white/35 before:to-transparent before:opacity-0 before:transition-[transform,opacity] before:duration-500 before:ease-enter hover:-translate-y-0.5 hover:bg-primary hover:text-white hover:shadow-[0_16px_38px_rgba(113,50,245,0.22)] hover:before:translate-x-[430%] hover:before:opacity-100 active:translate-y-0 active:scale-[0.985] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:border-border disabled:text-muted-foreground disabled:opacity-70 motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:hidden"
      >
        <span aria-hidden className="relative transition-transform duration-300 ease-enter group-hover:rotate-[-18deg] motion-reduce:transform-none">↷</span>
        <span className="relative">Show full audit</span>
      </button>
      <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground lg:inline">
        Skip replay
      </span>
    </div>
  );
}
