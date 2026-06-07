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

export class AccountApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
  }
}

const API_BASE = "/api/argus";
const REQUEST_TIMEOUT_MS = 30_000;

export async function getAccount(accessToken: string): Promise<AccountUser> {
  const resp = await accountFetch(`${API_BASE}/me`, { headers: authHeaders(accessToken) });
  await assertOk(resp, "account failed");
  return (await resp.json()) as AccountUser;
}

export async function listSavedApiKeys(accessToken: string): Promise<SavedApiKey[]> {
  const resp = await accountFetch(`${API_BASE}/me/api-keys`, {
    headers: authHeaders(accessToken),
  });
  await assertOk(resp, "api keys failed");
  return (await resp.json()) as SavedApiKey[];
}

export async function createSavedApiKey(
  accessToken: string,
  apiKey: string,
  label = "MiroMind API key",
  makeDefault = true,
): Promise<SavedApiKey> {
  const resp = await accountFetch(`${API_BASE}/me/api-keys`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ api_key: apiKey, label, make_default: makeDefault }),
  });
  await assertOk(resp, "save key failed");
  return (await resp.json()) as SavedApiKey;
}

export async function updateSavedApiKey(
  accessToken: string,
  keyId: string,
  patch: { label?: string; makeDefault?: boolean },
): Promise<SavedApiKey> {
  const resp = await accountFetch(`${API_BASE}/me/api-keys/${encodeURIComponent(keyId)}`, {
    method: "PATCH",
    headers: jsonAuthHeaders(accessToken),
    body: JSON.stringify({
      label: patch.label,
      make_default: patch.makeDefault,
    }),
  });
  await assertOk(resp, "update key failed");
  return (await resp.json()) as SavedApiKey;
}

export async function testSavedApiKey(
  accessToken: string,
  body: { apiKey?: string; keyId?: string },
): Promise<ApiKeyTestResult> {
  const resp = await accountFetch(`${API_BASE}/me/api-keys/test`, {
    method: "POST",
    headers: jsonAuthHeaders(accessToken),
    body: JSON.stringify({
      api_key: body.apiKey,
      key_id: body.keyId,
    }),
  });
  await assertOk(resp, "test key failed");
  return (await resp.json()) as ApiKeyTestResult;
}

export async function deleteSavedApiKey(
  accessToken: string,
  keyId: string,
): Promise<void> {
  const resp = await accountFetch(`${API_BASE}/me/api-keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (resp.status === 404) return;
  await assertOk(resp, "delete key failed");
}

export async function listJobSummaries(accessToken: string): Promise<JobSummary[]> {
  const resp = await accountFetch(`${API_BASE}/jobs`, { headers: authHeaders(accessToken) });
  await assertOk(resp, "history failed");
  const body = (await resp.json()) as { jobs: JobSummary[] };
  return body.jobs;
}

export async function createAuditShareLink(
  accessToken: string,
  jobId: string,
  expiresInDays = 30,
): Promise<ShareLinkSummary> {
  const resp = await accountFetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/share`, {
    method: "POST",
    headers: jsonAuthHeaders(accessToken),
    body: JSON.stringify({ expires_in_days: expiresInDays }),
  });
  await assertOk(resp, "share failed");
  return (await resp.json()) as ShareLinkSummary;
}

export async function revokeAuditShareLink(
  accessToken: string,
  jobId: string,
  token: string,
): Promise<void> {
  const resp = await accountFetch(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/share/${encodeURIComponent(token)}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (resp.status === 404) return;
  await assertOk(resp, "revoke share failed");
}

export async function deleteAuditJob(accessToken: string, jobId: string): Promise<void> {
  const resp = await accountFetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (resp.status === 404) return;
  await assertOk(resp, "delete audit failed");
}

export async function rerunAuditJob(
  accessToken: string,
  jobId: string,
): Promise<RerunResponse> {
  const resp = await accountFetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/rerun`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  await assertOk(resp, "rerun failed");
  return (await resp.json()) as RerunResponse;
}

export async function deleteAccountData(accessToken: string): Promise<void> {
  const resp = await accountFetch(`${API_BASE}/me`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  await assertOk(resp, "delete account failed");
}

export async function recordEvent(
  accessToken: string | null | undefined,
  eventName: string,
  options?: {
    path?: string;
    properties?: Record<string, unknown>;
    authRequired?: boolean;
  },
): Promise<void> {
  const resp = await accountFetch(`${API_BASE}/events`, {
    method: "POST",
    headers: {
      ...jsonHeaders(),
      ...authHeaders(accessToken),
    },
    body: JSON.stringify({
      event_name: eventName,
      path: options?.path,
      properties: options?.properties ?? {},
      auth_required: options?.authRequired ?? false,
    }),
  });
  await assertOk(resp, "event failed");
}

export function buildShareUrl(token: string): string {
  const path = `/share/${encodeURIComponent(token)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export function authHeaders(accessToken: string | null | undefined): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function jsonAuthHeaders(accessToken: string): Record<string, string> {
  return {
    ...authHeaders(accessToken),
    ...jsonHeaders(),
  };
}

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

async function assertOk(resp: Response, fallback: string): Promise<void> {
  if (resp.ok) return;
  const message = await responseMessage(resp);
  throw new AccountApiError(resp.status, message || `${fallback} (${resp.status})`);
}

async function responseMessage(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => "");
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    return text;
  }
  return text;
}

async function accountFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: init?.signal ?? controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AccountApiError(504, "Request timed out. Please retry.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
