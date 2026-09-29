import { apiFetch, authHeaders, ensureOk } from "@/lib/http";

export interface AccountUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

export interface SavedApiKey {
  id: string;
  provider: string;
  label: string;
  fingerprint: string;
  last4: string;
  is_default: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyTestResult {
  ok: boolean;
  message: string;
  response_id: string | null;
}

export interface ShareLinkSummary {
  token: string;
  job_id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at?: string | null;
}

export interface JobSummary {
  id: string;
  status: string;
  input_mode: "pdf" | "text" | string;
  title: string;
  created_at: string;
  completed_at: string | null;
  findings_count: number;
  claims_total: number;
  claims_audited: number;
  cost_usd: number;
  share_links?: ShareLinkSummary[];
}

export interface RerunResponse {
  job_id: string;
  status: string;
}

const TIMEOUT_MS = 30_000;

function jsonAuthHeaders(accessToken: string | null | undefined): Record<string, string> {
  return { ...authHeaders(accessToken), "Content-Type": "application/json" };
}

async function call<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const resp = await apiFetch(path, init, TIMEOUT_MS);
  await ensureOk(resp, fallback);
  return (await resp.json()) as T;
}

/** A DELETE that treats "already gone" (404) as done. */
async function remove(path: string, accessToken: string | null | undefined, fallback: string) {
  const resp = await apiFetch(path, { method: "DELETE", headers: authHeaders(accessToken) }, TIMEOUT_MS);
  if (resp.status === 404) return;
  await ensureOk(resp, fallback);
}

export function getAccount(accessToken: string): Promise<AccountUser> {
  return call("/me", { headers: authHeaders(accessToken) }, "account failed");
}

export function listSavedApiKeys(accessToken: string): Promise<SavedApiKey[]> {
  return call("/me/api-keys", { headers: authHeaders(accessToken) }, "api keys failed");
}

export function createSavedApiKey(
  accessToken: string,
  apiKey: string,
  label = "MiroMind API key",
  makeDefault = true,
): Promise<SavedApiKey> {
  return call(
    "/me/api-keys",
    {
      method: "POST",
      headers: jsonAuthHeaders(accessToken),
      body: JSON.stringify({ api_key: apiKey, label, make_default: makeDefault }),
    },
    "save key failed",
  );
}

export function updateSavedApiKey(
  accessToken: string,
  keyId: string,
  patch: { label?: string; makeDefault?: boolean },
): Promise<SavedApiKey> {
  return call(
    `/me/api-keys/${encodeURIComponent(keyId)}`,
    {
      method: "PATCH",
      headers: jsonAuthHeaders(accessToken),
      body: JSON.stringify({ label: patch.label, make_default: patch.makeDefault }),
    },
    "update key failed",
  );
}

export function testSavedApiKey(
  accessToken: string,
  body: { apiKey?: string; keyId?: string },
): Promise<ApiKeyTestResult> {
  return call(
    "/me/api-keys/test",
    {
      method: "POST",
      headers: jsonAuthHeaders(accessToken),
      body: JSON.stringify({ api_key: body.apiKey, key_id: body.keyId }),
    },
    "test key failed",
  );
}

export function deleteSavedApiKey(accessToken: string, keyId: string): Promise<void> {
  return remove(`/me/api-keys/${encodeURIComponent(keyId)}`, accessToken, "delete key failed");
}

export async function listJobSummaries(accessToken?: string | null): Promise<JobSummary[]> {
  const body = await call<{ jobs: JobSummary[] }>(
    "/jobs",
    { headers: authHeaders(accessToken) },
    "history failed",
  );
  return body.jobs;
}

export function createAuditShareLink(
  accessToken: string,
  jobId: string,
  expiresInDays = 30,
): Promise<ShareLinkSummary> {
  return call(
    `/jobs/${encodeURIComponent(jobId)}/share`,
    {
      method: "POST",
      headers: jsonAuthHeaders(accessToken),
      body: JSON.stringify({ expires_in_days: expiresInDays }),
    },
    "share failed",
  );
}

export function revokeAuditShareLink(
  accessToken: string,
  jobId: string,
  token: string,
): Promise<void> {
  return remove(
    `/jobs/${encodeURIComponent(jobId)}/share/${encodeURIComponent(token)}`,
    accessToken,
    "revoke share failed",
  );
}

export function deleteAuditJob(accessToken: string | null | undefined, jobId: string): Promise<void> {
  return remove(`/jobs/${encodeURIComponent(jobId)}`, accessToken, "delete audit failed");
}

export function rerunAuditJob(accessToken: string, jobId: string): Promise<RerunResponse> {
  return call(
    `/jobs/${encodeURIComponent(jobId)}/rerun`,
    { method: "POST", headers: authHeaders(accessToken) },
    "rerun failed",
  );
}

export async function deleteAccountData(accessToken: string): Promise<void> {
  const resp = await apiFetch(
    "/me",
    { method: "DELETE", headers: authHeaders(accessToken) },
    TIMEOUT_MS,
  );
  await ensureOk(resp, "delete account failed");
}

export async function recordEvent(
  accessToken: string | null | undefined,
  eventName: string,
  options?: { path?: string; properties?: Record<string, unknown> },
): Promise<void> {
  const resp = await apiFetch(
    "/events",
    {
      method: "POST",
      headers: jsonAuthHeaders(accessToken),
      body: JSON.stringify({
        event_name: eventName,
        path: options?.path,
        properties: options?.properties ?? {},
      }),
    },
    TIMEOUT_MS,
  );
  await ensureOk(resp, "event failed");
}

export function buildShareUrl(token: string): string {
  const path = `/share/${encodeURIComponent(token)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}
