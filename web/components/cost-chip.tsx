interface Props {
  costUsd: number | null;
}

export function CostChip({ costUsd }: Props) {
  if (costUsd === null || costUsd === undefined) return null;
  return (
    <span
      title="Argus uses MiroMind for verification and DeepSeek for atomization and debate — see the cost breakdown."
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
    >
      <span className="font-medium text-foreground">${costUsd.toFixed(2)}</span>
      <span>vs ~$70 manual</span>
    </span>
  );
}
