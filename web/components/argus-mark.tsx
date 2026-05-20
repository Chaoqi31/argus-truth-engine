interface Props {
  size?: number;
  className?: string;
}

/**
 * Argus brand mark — a stylised eye with four satellite dots, one per agent
 * (Planner / Citation Verifier / Citation Alignment / Data Freshness),
 * echoing the mythological "hundred-eyed Argus" who never blinked.
 */
export function ArgusMark({ size = 22, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Argus"
    >
      {/* Eye outline */}
      <path
        d="M3 16C5.5 9.5 10.2 6 16 6c5.8 0 10.5 3.5 13 10-2.5 6.5-7.2 10-13 10C10.2 26 5.5 22.5 3 16Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      {/* Iris */}
      <circle cx="16" cy="16" r="4.2" stroke="currentColor" strokeWidth="1.7" />
      {/* Pupil */}
      <circle cx="16" cy="16" r="1.6" fill="currentColor" />
      {/* Four satellite dots — one per specialist agent */}
      <circle cx="6.5" cy="6.5" r="1.3" fill="currentColor" />
      <circle cx="25.5" cy="6.5" r="1.3" fill="currentColor" />
      <circle cx="6.5" cy="25.5" r="1.3" fill="currentColor" />
      <circle cx="25.5" cy="25.5" r="1.3" fill="currentColor" />
    </svg>
  );
}
