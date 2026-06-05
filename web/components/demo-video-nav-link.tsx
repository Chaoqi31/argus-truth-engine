import Link from "next/link";

export function DemoVideoNavLink() {
  return (
    <Link
      href="/demo-video"
      aria-label="Watch the Argus demo video"
      className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-[12px] border border-primary/25 bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary shadow-[0_8px_22px_rgba(102,63,255,0.10)] transition-[transform,border-color,box-shadow,background-color] duration-300 ease-enter hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary-soft/80 hover:shadow-[0_14px_34px_rgba(102,63,255,0.18)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-y-6 -left-1/2 w-1/3 rotate-12 bg-gradient-to-r from-transparent via-primary/18 to-transparent opacity-0 transition-[transform,opacity] duration-500 ease-enter group-hover:translate-x-[430%] group-hover:opacity-100 motion-reduce:hidden"
      />
      <span
        aria-hidden="true"
        className="relative flex size-4 items-center justify-center rounded-full bg-primary text-white transition-transform duration-300 ease-enter group-hover:scale-110 motion-reduce:transform-none"
      >
        <svg viewBox="0 0 16 16" className="ml-px size-2.5" fill="currentColor">
          <path d="M5.25 3.75v8.5L12 8 5.25 3.75z" />
        </svg>
      </span>
      <span className="relative whitespace-nowrap">Demo video</span>
      <span
        aria-hidden="true"
        className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary/70 shadow-[0_0_0_4px_rgba(102,63,255,0.10)]"
      />
    </Link>
  );
}
