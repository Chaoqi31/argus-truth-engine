"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArgusHeader } from "@/components/argus-header";
import {
  createSavedApiKey,
  deleteSavedApiKey,
  listJobSummaries,
  listSavedApiKeys,
  type JobSummary,
  type SavedApiKey,
} from "@/lib/account";
import { useAuthSession } from "@/lib/use-auth-session";

export default function AppHomePage() {
  const auth = useAuthSession();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [keys, setKeys] = useState<SavedApiKey[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.accessToken) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setLoading(true);
    });
    Promise.all([
      listJobSummaries(auth.accessToken),
      listSavedApiKeys(auth.accessToken),
    ])
      .then(([nextJobs, nextKeys]) => {
        if (!active) return;
        setJobs(nextJobs);
        setKeys(nextKeys);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.accessToken]);

  const userLabel = useMemo(() => {
    if (!auth.user) return "";
    return auth.user.user_metadata?.full_name ?? auth.user.email ?? "Your account";
  }, [auth.user]);

  async function saveKey() {
    if (!auth.accessToken || !apiKey.trim()) return;
    setLoading(true);
    try {
      const saved = await createSavedApiKey(auth.accessToken, apiKey.trim());
      setKeys((prev) => [saved, ...prev.filter((k) => k.id !== saved.id)]);
      setApiKey("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function removeKey(keyId: string) {
    if (!auth.accessToken) return;
    await deleteSavedApiKey(auth.accessToken, keyId);
    setKeys((prev) => prev.filter((k) => k.id !== keyId));
  }

  if (!auth.configured) {
    return (
      <>
        <ArgusHeader />
        <CenteredMessage
          title="Google sign-in is not configured"
          body="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable account history."
        />
      </>
    );
  }

  if (auth.loading) {
    return (
      <>
        <ArgusHeader />
        <CenteredMessage title="Loading account" body="Checking your session..." />
      </>
    );
  }

  if (!auth.user) {
    return (
      <>
        <ArgusHeader />
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col items-center justify-center px-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Argus</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Save your audit history, reuse your MiroMind API key, and keep private audit URLs protected.
          </p>
          <button
            type="button"
            onClick={() => auth.signIn("/app")}
            className="mt-6 rounded-[12px] bg-primary px-5 py-2.5 text-sm font-semibold text-white"
          >
            Continue with Google
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <ArgusHeader />
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Personal workspace
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{userLabel}</h1>
            </div>
            <Link
              href="/audit"
              className="rounded-[12px] bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              New audit
            </Link>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-background">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Audit history</h2>
            </div>
            {loading && jobs.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Loading audits...</p>
            ) : jobs.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No saved audits yet. Run your first audit to see it here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/audit?id=${encodeURIComponent(job.id)}`}
                      className="grid gap-2 px-4 py-3 transition-colors hover:bg-muted/60 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{job.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {job.input_mode.toUpperCase()} · {formatDate(job.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded border border-border px-2 py-1 font-mono uppercase">
                          {job.status}
                        </span>
                        <span>{job.findings_count} findings</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="min-w-0">
          <section className="rounded-lg border border-border bg-background p-4">
            <h2 className="text-sm font-semibold">MiroMind API key</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Saved keys are encrypted server-side. Argus only shows the last four characters.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
              />
              <button
                type="button"
                onClick={saveKey}
                disabled={!apiKey.trim() || loading}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
            {keys.length > 0 && (
              <ul className="mt-4 divide-y divide-border rounded-md border border-border">
                {keys.map((key) => (
                  <li key={key.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{key.label}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        ****{key.last4} {key.is_default ? "· default" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeKey(key.id)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p role="alert" className="mt-3 text-xs text-[var(--cc-danger,#d92d20)]">
                {error}
              </p>
            )}
          </section>
        </aside>
      </main>
    </>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </main>
  );
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
