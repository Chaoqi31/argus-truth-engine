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
        className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border border-[var(--cc-primary)] bg-background px-3 py-1.5 text-xs font-semibold text-[var(--cc-primary)] shadow-[var(--shadow-card)] transition-colors hover:bg-primary hover:text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:border-border disabled:text-muted-foreground disabled:opacity-70"
      >
        <span aria-hidden>↷</span>
        Show full audit
      </button>
      <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground lg:inline">
        Skip replay
      </span>
    </div>
  );
}
