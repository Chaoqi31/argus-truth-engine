interface Props {
  size?: number;
  className?: string;
}

/** Argus brand mark — the "A" eye logo (project icon, /public/argus-icon.png). */
export function ArgusMark({ size = 30, className = "" }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/argus-icon.png"
      alt="Argus"
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
