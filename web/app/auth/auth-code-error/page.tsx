import Link from "next/link";
import { ArgusMark } from "@/components/argus-mark";
import { AuthButton } from "@/components/auth-button";

export default async function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const reason = explainReason(params.reason);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-6">
      <section className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2">
          <ArgusMark className="text-primary" />
          <span className="text-lg font-semibold">Argus</span>
        </div>
        <h1 className="mt-6 text-xl font-semibold">Sign-in failed</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The Google sign-in session could not be completed. {reason}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <AuthButton next={next} signInLabel="Try Google again" />
          <Link
            href={next}
            className="inline-flex rounded-[10px] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground"
          >
            Back to Argus
          </Link>
        </div>
      </section>
    </main>
  );
}

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

function explainReason(value: string | undefined): string {
  if (!value || value === "missing_oauth_code") {
    return "Please start the login flow again.";
  }
  return value;
}
