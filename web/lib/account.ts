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
}

const API_BASE = "/api/argus";

export async function getAccount(accessToken: string): Promise<AccountUser> {
  const resp = await fetch(`${API_BASE}/me`, { headers: authHeaders(accessToken) });
  if (!resp.ok) throw new Error(`account failed (${resp.status})`);
  return (await resp.json()) as AccountUser;
}

export async function listSavedApiKeys(accessToken: string): Promise<SavedApiKey[]> {
  const resp = await fetch(`${API_BASE}/me/api-keys`, {
    headers: authHeaders(accessToken),
  });
  if (!resp.ok) throw new Error(`api keys failed (${resp.status})`);
  return (await resp.json()) as SavedApiKey[];
}

export async function createSavedApiKey(
  accessToken: string,
  apiKey: string,
  label = "MiroMind API key",
): Promise<SavedApiKey> {
  const resp = await fetch(`${API_BASE}/me/api-keys`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ api_key: apiKey, label, make_default: true }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `save key failed (${resp.status})`);
  }
  return (await resp.json()) as SavedApiKey;
}

export async function deleteSavedApiKey(
  accessToken: string,
  keyId: string,
): Promise<void> {
  const resp = await fetch(`${API_BASE}/me/api-keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`delete key failed (${resp.status})`);
  }
}

export async function listJobSummaries(accessToken: string): Promise<JobSummary[]> {
  const resp = await fetch(`${API_BASE}/jobs`, { headers: authHeaders(accessToken) });
  if (!resp.ok) throw new Error(`history failed (${resp.status})`);
  const body = (await resp.json()) as { jobs: JobSummary[] };
  return body.jobs;
}

export function authHeaders(accessToken: string | null | undefined): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}
