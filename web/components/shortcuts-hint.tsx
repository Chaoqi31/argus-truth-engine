"use client";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ["J / ↓", "Next finding"],
  ["K / ↑", "Previous finding"],
  ["?", "Toggle this hint"],
];

export function ShortcutsHint({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed bottom-6 right-6 z-50 w-64 rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--shadow-card-hover)]"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Shortcuts
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close shortcuts"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <ul className="space-y-1.5 text-xs">
        {SHORTCUTS.map(([k, desc]) => (
          <li key={k} className="flex items-center justify-between gap-3">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              {k}
            </kbd>
            <span className="text-muted-foreground">{desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
