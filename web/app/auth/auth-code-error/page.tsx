import Link from "next/link";
import { ArgusMark } from "@/components/argus-mark";

export default function AuthCodeErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-6">
      <section className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2">
          <ArgusMark className="text-primary" />
          <span className="text-lg font-semibold">Argus</span>
        </div>
        <h1 className="mt-6 text-xl font-semibold">Sign-in failed</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The Google sign-in session could not be completed. Please try again.
        </p>
        <Link
          href="/app"
          className="mt-5 inline-flex rounded-[10px] bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Back to Argus
        </Link>
      </section>
    </main>
  );
}
