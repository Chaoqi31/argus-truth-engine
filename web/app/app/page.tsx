"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArgusHeader } from "@/components/argus-header";
import { AuthButton } from "@/components/auth-button";
import {
  AccountApiError,
  buildShareUrl,
  createAuditShareLink,
  createSavedApiKey,
  deleteAccountData,
  deleteAuditJob,
  deleteSavedApiKey,
  listJobSummaries,
  listSavedApiKeys,
  recordEvent,
  rerunAuditJob,
  revokeAuditShareLink,
  testSavedApiKey,
  updateSavedApiKey,
  type ApiKeyTestResult,
  type JobSummary,
  type SavedApiKey,
  type ShareLinkSummary,
} from "@/lib/account";
import { useAuthSession } from "@/lib/use-auth-session";

type StatusFilter = "all" | "active" | "done" | "failed";
type ModeFilter = "all" | "text" | "pdf";

export default function AppHomePage() {
  return (
    <Suspense fallback={null}>
      <AppHomeContent />
    </Suspense>
  );
}

function AppHomeContent() {
  const auth = useAuthSession();
  const router = useRouter();
  const params = useSearchParams();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [keys, setKeys] = useState<SavedApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyLabel, setApiKeyLabel] = useState("MiroMind API key");
  const [keyBusy, setKeyBusy] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [keyTest, setKeyTest] = useState<ApiKeyTestResult | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const accessToken = auth.accessToken;

  const loadWorkspace = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setSessionExpired(false);
    try {
      const [nextJobs, nextKeys] = await Promise.all([
        listJobSummaries(accessToken),
        listSavedApiKeys(accessToken),
      ]);
      setJobs(nextJobs);
      setKeys(nextKeys);
      setError(null);
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadWorkspace();
    });
  }, [loadWorkspace]);

  useEffect(() => {
    if (!accessToken) return;
    if (params.get("signedIn") === "1") {
      queueMicrotask(() => {
        setMessage("Signed in. Your workspace is ready.");
      });
      const clean = new URLSearchParams(params.toString());
      clean.delete("signedIn");
      const qs = clean.toString();
      router.replace(`/app${qs ? `?${qs}` : ""}`, { scroll: false });
    }
    void recordEvent(accessToken, "workspace_viewed", {
      path: "/app",
      properties: { signed_in: true },
    }).catch(() => undefined);
  }, [accessToken, params, router]);

  const userLabel = useMemo(() => {
    if (!auth.user) return "";
    const fullName = auth.user.user_metadata?.full_name;
    if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
    const name = auth.user.user_metadata?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
    return auth.user.email ?? "Your account";
  }, [auth.user]);

  const stats = useMemo(() => getStats(jobs, keys), [jobs, keys]);
  const filteredJobs = useMemo(
    () => filterJobs(jobs, query, statusFilter, modeFilter),
    [jobs, query, statusFilter, modeFilter],
  );
  const defaultKey = keys.find((key) => key.is_default) ?? null;

  async function saveKey() {
    if (!accessToken || !apiKey.trim()) return;
    setKeyBusy("save");
    setKeyTest(null);
    try {
      const saved = await createSavedApiKey(
        accessToken,
        apiKey.trim(),
        apiKeyLabel.trim() || "MiroMind API key",
      );
      setKeys((prev) => [saved, ...prev.filter((key) => key.id !== saved.id)]);
      setApiKey("");
      setApiKeyLabel("MiroMind API key");
      setMessage("API key saved and set as default.");
      setError(null);
      void recordEvent(accessToken, "api_key_saved", { path: "/app" }).catch(() => undefined);
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setKeyBusy(null);
    }
  }

  async function testRawKey() {
    if (!accessToken || !apiKey.trim()) return;
    setKeyBusy("test-raw");
    setKeyTest(null);
    try {
      const result = await testSavedApiKey(accessToken, { apiKey: apiKey.trim() });
      setKeyTest(result);
      setMessage(result.ok ? "MiroMind accepted this key." : null);
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setKeyBusy(null);
    }
  }

  async function testExistingKey(keyId: string) {
    if (!accessToken) return;
    setKeyBusy(`test-${keyId}`);
    setKeyTest(null);
    try {
      const result = await testSavedApiKey(accessToken, { keyId });
      setKeyTest(result);
      setMessage(result.ok ? "Saved API key is working." : null);
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setKeyBusy(null);
    }
  }

  async function renameKey(key: SavedApiKey) {
    if (!accessToken || !labelDraft.trim()) return;
    setKeyBusy(`rename-${key.id}`);
    try {
      const updated = await updateSavedApiKey(accessToken, key.id, { label: labelDraft.trim() });
      setKeys((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setEditingKeyId(null);
      setLabelDraft("");
      setMessage("API key label updated.");
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setKeyBusy(null);
    }
  }

  async function makeDefaultKey(keyId: string) {
    if (!accessToken) return;
    setKeyBusy(`default-${keyId}`);
    try {
      await updateSavedApiKey(accessToken, keyId, { makeDefault: true });
      const nextKeys = await listSavedApiKeys(accessToken);
      setKeys(nextKeys);
      setMessage("Default API key updated.");
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setKeyBusy(null);
    }
  }

  async function removeKey(keyId: string) {
    if (!accessToken) return;
    if (!window.confirm("Delete this saved API key?")) return;
    setKeyBusy(`delete-${keyId}`);
    try {
      await deleteSavedApiKey(accessToken, keyId);
      setKeys((prev) => prev.filter((key) => key.id !== keyId));
      setMessage("API key deleted.");
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setKeyBusy(null);
    }
  }

  async function rerunJob(jobId: string) {
    if (!accessToken) return;
    setJobBusy(`rerun-${jobId}`);
    try {
      const result = await rerunAuditJob(accessToken, jobId);
      void recordEvent(accessToken, "audit_rerun_started", {
        path: "/app",
        properties: { source_job_id: jobId, new_job_id: result.job_id },
      }).catch(() => undefined);
      router.push(`/audit?id=${encodeURIComponent(result.job_id)}`);
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setJobBusy(null);
    }
  }

  async function shareJob(jobId: string) {
    if (!accessToken) return;
    setJobBusy(`share-${jobId}`);
    try {
      const link = await createAuditShareLink(accessToken, jobId, 30);
      setJobs((prev) => updateJobShareLinks(prev, jobId, [link, ...activeShareLinks(prev, jobId)]));
      const shareUrl = buildShareUrl(link.token);
      await copyText(shareUrl);
      setMessage("Share link copied. Anyone with this link can view this read-only audit.");
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setJobBusy(null);
    }
  }

  async function copyShareLink(token: string) {
    await copyText(buildShareUrl(token));
    setMessage("Share link copied.");
  }

  async function revokeShare(jobId: string, token: string) {
    if (!accessToken) return;
    setJobBusy(`revoke-${jobId}`);
    try {
      await revokeAuditShareLink(accessToken, jobId, token);
      setJobs((prev) =>
        updateJobShareLinks(
          prev,
          jobId,
          activeShareLinks(prev, jobId).filter((link) => link.token !== token),
        ),
      );
      setMessage("Share link revoked.");
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setJobBusy(null);
    }
  }

  async function deleteJob(jobId: string) {
    if (!accessToken) return;
    if (!window.confirm("Delete this audit record from your workspace?")) return;
    setJobBusy(`delete-${jobId}`);
    try {
      await deleteAuditJob(accessToken, jobId);
      setJobs((prev) => prev.filter((job) => job.id !== jobId));
      setMessage("Audit record deleted.");
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setJobBusy(null);
    }
  }

  async function deleteAccount() {
    if (!accessToken || deleteConfirm !== "DELETE") return;
    if (!window.confirm("Delete all Argus records and saved API keys for this account?")) return;
    setKeyBusy("delete-account");
    try {
      await deleteAccountData(accessToken);
      setMessage("Account data deleted.");
      await auth.signOut();
      router.push("/audit");
    } catch (err) {
      handleError(err, setError, setSessionExpired);
    } finally {
      setKeyBusy(null);
    }
  }

  if (!auth.configured) {
    return (
      <>
        <ArgusHeader />
        <CenteredMessage
          title="Google sign-in is not configured"
          body="Set the Supabase public URL and publishable key to enable account history."
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
            Use Google to keep audit records private, save encrypted MiroMind API keys, and return to previous runs.
          </p>
          <div className="mt-6">
            <AuthButton next="/app" signInLabel="Continue with Google" />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <ArgusHeader />
      <main className="min-h-[calc(100vh-3.5rem)] bg-muted/40">
        <div className="mx-auto max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
          <section className="rounded-lg border border-border bg-background p-5 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success-foreground">
                  <span aria-hidden className="size-2 rounded-full bg-success" />
                  Signed in
                </div>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight">{userLabel}</h1>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Your saved audits, encrypted MiroMind API keys, and private sharing controls are available here.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadWorkspace}
                  disabled={loading}
                  className="rounded-[10px] border border-border bg-background px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
                <Link
                  href="/audit"
                  className="rounded-[10px] bg-primary px-3.5 py-2 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(113,50,245,0.22)] transition-colors hover:bg-[#5741d8]"
                >
                  New audit
                </Link>
              </div>
            </div>

            <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Saved audits" value={stats.audits} />
              <Stat label="Findings found" value={stats.findings} />
              <Stat label="Running now" value={stats.active} />
              <Stat label="Saved keys" value={stats.keys} />
            </dl>
          </section>

          {(message || error || sessionExpired) && (
            <section className="mt-4 rounded-lg border border-border bg-background p-4 shadow-[var(--shadow-card)]">
              {message && (
                <p role="status" className="text-sm font-medium text-success-foreground">
                  {message}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm font-medium text-destructive-foreground">
                  {error}
                </p>
              )}
              {sessionExpired && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <AuthButton next="/app" signInLabel="Sign in again" />
                  <span className="text-xs text-muted-foreground">
                    Your Google session needs to be refreshed before private records can load.
                  </span>
                </div>
              )}
            </section>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section
              id="history"
              className="min-w-0 rounded-lg border border-border bg-background shadow-[var(--shadow-card)]"
            >
              <div className="border-b border-border p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Audit history</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Reopen, rerun, share, or delete previous audit runs.
                    </p>
                  </div>
                  {jobs[0] && (
                    <Link
                      href={`/audit?id=${encodeURIComponent(jobs[0].id)}`}
                      className="rounded-[10px] border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      Continue latest
                    </Link>
                  )}
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search audit title or job id..."
                    className="min-w-0 rounded-[10px] border border-border bg-background px-3 py-2 text-sm outline-hidden transition-colors focus:border-primary"
                  />
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className="rounded-[10px] border border-border bg-background px-3 py-2 text-sm outline-hidden transition-colors focus:border-primary"
                  >
                    <option value="all">All status</option>
                    <option value="active">Active</option>
                    <option value="done">Done</option>
                    <option value="failed">Failed</option>
                  </select>
                  <select
                    value={modeFilter}
                    onChange={(event) => setModeFilter(event.target.value as ModeFilter)}
                    className="rounded-[10px] border border-border bg-background px-3 py-2 text-sm outline-hidden transition-colors focus:border-primary"
                  >
                    <option value="all">All inputs</option>
                    <option value="text">Text</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>
              </div>

              {loading && jobs.length === 0 ? (
                <div className="p-6">
                  <div className="animate-shimmer h-3 w-48 rounded-full" aria-hidden />
                  <p className="mt-3 text-sm text-muted-foreground">Loading saved audits...</p>
                </div>
              ) : filteredJobs.length === 0 ? (
                <EmptyHistory hasJobs={jobs.length > 0} />
              ) : (
                <ul className="divide-y divide-border">
                  {filteredJobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      busy={jobBusy}
                      onRerun={() => rerunJob(job.id)}
                      onShare={() => shareJob(job.id)}
                      onCopyShare={copyShareLink}
                      onRevokeShare={(token) => revokeShare(job.id, token)}
                      onDelete={() => deleteJob(job.id)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <aside className="grid min-w-0 gap-6">
              <section className="rounded-lg border border-border bg-background p-4 shadow-[var(--shadow-card)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">MiroMind API keys</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Keys are encrypted before storage and only the last four characters are shown.
                    </p>
                  </div>
                  {defaultKey && (
                    <span className="shrink-0 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success-foreground">
                      Default: ****{defaultKey.last4}
                    </span>
                  )}
                </div>

                <div className="mt-4 grid gap-2">
                  <label className="grid gap-1 text-sm font-medium">
                    Key label
                    <input
                      value={apiKeyLabel}
                      onChange={(event) => setApiKeyLabel(event.target.value)}
                      className="rounded-[10px] border border-border bg-background px-3 py-2 text-sm outline-hidden transition-colors focus:border-primary"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-medium">
                    API key
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => {
                        setApiKey(event.target.value);
                        setKeyTest(null);
                      }}
                      placeholder="sk-..."
                      className="rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-sm outline-hidden transition-colors focus:border-primary"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={testRawKey}
                      disabled={!apiKey.trim() || keyBusy === "test-raw"}
                      className="rounded-[10px] border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {keyBusy === "test-raw" ? "Testing..." : "Test key"}
                    </button>
                    <button
                      type="button"
                      onClick={saveKey}
                      disabled={!apiKey.trim() || keyBusy === "save"}
                      className="rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#5741d8] disabled:opacity-50"
                    >
                      {keyBusy === "save" ? "Saving..." : "Save as default"}
                    </button>
                  </div>
                  {keyTest && (
                    <p
                      className={`rounded-[10px] border px-3 py-2 text-sm ${
                        keyTest.ok
                          ? "border-success/20 bg-success/10 text-success-foreground"
                          : "border-destructive/20 bg-destructive/10 text-destructive-foreground"
                      }`}
                    >
                      {keyTest.message}
                    </p>
                  )}
                </div>

                <div className="mt-5 divide-y divide-border rounded-lg border border-border">
                  {keys.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      No saved key yet. You can still paste a key on the audit page.
                    </p>
                  ) : (
                    keys.map((key) => (
                      <div key={key.id} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {editingKeyId === key.id ? (
                              <input
                                value={labelDraft}
                                onChange={(event) => setLabelDraft(event.target.value)}
                                className="w-full rounded-[8px] border border-border bg-background px-2 py-1 text-sm font-medium outline-hidden focus:border-primary"
                              />
                            ) : (
                              <p className="truncate text-sm font-semibold">{key.label}</p>
                            )}
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              ****{key.last4} - {key.is_default ? "default" : "saved"} - created{" "}
                              {formatDate(key.created_at)}
                            </p>
                          </div>
                          <StatusPill status={key.is_default ? "default" : "saved"} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {editingKeyId === key.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => renameKey(key)}
                                disabled={!labelDraft.trim() || keyBusy === `rename-${key.id}`}
                                className="rounded-[8px] bg-primary px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                Save label
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingKeyId(null);
                                  setLabelDraft("");
                                }}
                                className="rounded-[8px] border border-border px-2.5 py-1.5 text-xs font-semibold"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingKeyId(key.id);
                                setLabelDraft(key.label);
                              }}
                              className="rounded-[8px] border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                            >
                              Rename
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => testExistingKey(key.id)}
                            disabled={keyBusy === `test-${key.id}`}
                            className="rounded-[8px] border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                          >
                            {keyBusy === `test-${key.id}` ? "Testing..." : "Test"}
                          </button>
                          {!key.is_default && (
                            <button
                              type="button"
                              onClick={() => makeDefaultKey(key.id)}
                              disabled={keyBusy === `default-${key.id}`}
                              className="rounded-[8px] border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                            >
                              Make default
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeKey(key.id)}
                            disabled={keyBusy === `delete-${key.id}`}
                            className="rounded-[8px] border border-destructive/25 px-2.5 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/10 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-background p-4 shadow-[var(--shadow-card)]">
                <h2 className="text-base font-semibold">Account data</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Delete all Argus audit records, share links, access logs, analytics events, and encrypted API keys for this account.
                </p>
                <label className="mt-4 grid gap-1 text-sm font-medium">
                  Type DELETE to confirm
                  <input
                    value={deleteConfirm}
                    onChange={(event) => setDeleteConfirm(event.target.value)}
                    className="rounded-[10px] border border-border bg-background px-3 py-2 text-sm outline-hidden transition-colors focus:border-primary"
                  />
                </label>
                <button
                  type="button"
                  onClick={deleteAccount}
                  disabled={deleteConfirm !== "DELETE" || keyBusy === "delete-account"}
                  className="mt-3 w-full rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/15 disabled:opacity-50"
                >
                  {keyBusy === "delete-account" ? "Deleting..." : "Delete account data"}
                </button>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}

function JobRow({
  job,
  busy,
  onRerun,
  onShare,
  onCopyShare,
  onRevokeShare,
  onDelete,
}: {
  job: JobSummary;
  busy: string | null;
  onRerun: () => void;
  onShare: () => void;
  onCopyShare: (token: string) => void;
  onRevokeShare: (token: string) => void;
  onDelete: () => void;
}) {
  const activeLinks = (job.share_links ?? []).filter((link) => !link.revoked_at);
  const share = activeLinks[0] ?? null;
  const shareUrl = share ? buildShareUrl(share.token) : null;

  return (
    <li className="p-4 transition-colors hover:bg-muted/45">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/audit?id=${encodeURIComponent(job.id)}`}
              className="min-w-0 truncate text-sm font-semibold text-foreground underline-offset-2 hover:text-primary hover:underline"
            >
              {job.title || job.id}
            </Link>
            <StatusPill status={job.status} />
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
              {job.input_mode}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {formatDate(job.created_at)} - {job.findings_count} findings - {job.claims_audited}/
            {job.claims_total} claims - ${job.cost_usd.toFixed(3)}
          </p>
          {shareUrl && (
            <div className="mt-3 grid gap-2 rounded-[10px] border border-primary/15 bg-primary-soft/45 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary">Read-only share link active</p>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{shareUrl}</p>
                {share.expires_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Expires {formatDate(share.expires_at)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onCopyShare(share.token)}
                  className="rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => onRevokeShare(share.token)}
                  disabled={busy === `revoke-${job.id}`}
                  className="rounded-[8px] border border-destructive/25 bg-background px-2.5 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/10 disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-2 xl:justify-end">
          <Link
            href={`/audit?id=${encodeURIComponent(job.id)}`}
            className="rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
          >
            Open
          </Link>
          <button
            type="button"
            onClick={onRerun}
            disabled={busy === `rerun-${job.id}`}
            className="rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            {busy === `rerun-${job.id}` ? "Starting..." : "Rerun"}
          </button>
          <button
            type="button"
            onClick={onShare}
            disabled={busy === `share-${job.id}`}
            className="rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            {busy === `share-${job.id}` ? "Sharing..." : "Share"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy === `delete-${job.id}`}
            className="rounded-[8px] border border-destructive/25 bg-background px-2.5 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/10 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function EmptyHistory({ hasJobs }: { hasJobs: boolean }) {
  return (
    <div className="p-8 text-center">
      <h3 className="text-sm font-semibold">
        {hasJobs ? "No audits match these filters" : "No saved audits yet"}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {hasJobs
          ? "Change the filters or search term to see more records."
          : "Run a text or PDF audit while signed in and the result will appear here."}
      </p>
      {!hasJobs && (
        <Link
          href="/audit"
          className="mt-4 inline-flex rounded-[10px] bg-primary px-3.5 py-2 text-sm font-semibold text-white"
        >
          Start an audit
        </Link>
      )}
    </div>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/45 p-3">
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const cls =
    normalized === "done" || normalized === "default"
      ? "border-success/20 bg-success/10 text-success-foreground"
      : normalized === "failed" || normalized === "interrupted"
        ? "border-destructive/20 bg-destructive/10 text-destructive-foreground"
        : "border-primary/15 bg-primary-soft text-primary";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${cls}`}>
      {status}
    </span>
  );
}

function getStats(jobs: JobSummary[], keys: SavedApiKey[]) {
  return {
    audits: jobs.length,
    findings: jobs.reduce((sum, job) => sum + job.findings_count, 0),
    active: jobs.filter((job) => isActive(job.status)).length,
    keys: keys.length,
  };
}

function filterJobs(
  jobs: JobSummary[],
  query: string,
  statusFilter: StatusFilter,
  modeFilter: ModeFilter,
): JobSummary[] {
  const q = query.trim().toLowerCase();
  return jobs.filter((job) => {
    if (q && !`${job.title} ${job.id}`.toLowerCase().includes(q)) return false;
    if (modeFilter !== "all" && job.input_mode !== modeFilter) return false;
    if (statusFilter === "active") return isActive(job.status);
    if (statusFilter === "done") return job.status === "done";
    if (statusFilter === "failed") return job.status === "failed" || job.status === "interrupted";
    return true;
  });
}

function isActive(status: string): boolean {
  return !["done", "failed", "interrupted"].includes(status);
}

function activeShareLinks(jobs: JobSummary[], jobId: string): ShareLinkSummary[] {
  return jobs.find((job) => job.id === jobId)?.share_links?.filter((link) => !link.revoked_at) ?? [];
}

function updateJobShareLinks(
  jobs: JobSummary[],
  jobId: string,
  shareLinks: ShareLinkSummary[],
): JobSummary[] {
  return jobs.map((job) => (job.id === jobId ? { ...job, share_links: shareLinks } : job));
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  }
}

function handleError(
  err: unknown,
  setError: (value: string | null) => void,
  setSessionExpired: (value: boolean) => void,
) {
  if (err instanceof AccountApiError && err.status === 401) {
    setSessionExpired(true);
    setError("Your session expired.");
    return;
  }
  setError(err instanceof Error ? err.message : String(err));
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
