import type { Severity } from "@/lib/types";
import { severityClass } from "@/lib/colors";

interface Props {
  severity: Severity;
  className?: string;
  "data-testid"?: string;
}

export function SeverityBadge({ severity, className = "", ...rest }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${severityClass[severity]} ${className}`}
      {...rest}
    >
      {severity}
    </span>
  );
}
