import type { Job } from "@/lib/types";
import { authHeaders } from "@/lib/account";

const API_BASE = "/api/argus";

async function responseMessage(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => "");
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    return typeof parsed.detail === "string" ? parsed.detail : text;
  } catch {
    return text;
  }
}

export class ArgusApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ArgusApiError";
    this.status = status;
  }
}

export class UnsupportedMediaTypeError extends ArgusApiError {
  constructor(message = "unsupported media type") {
    super(415, message);
    this.name = "UnsupportedMediaTypeError";
  }
}

export class JobNotFoundError extends ArgusApiError {
  constructor(jobId: string) {
    super(404, `job not found: ${jobId}`);
    this.name = "JobNotFoundError";
  }
}

export interface UploadResponse {
  job_id: string;
  status: string;
}

export interface ApiRequestOptions {
  accessToken?: string | null;
  apiKeyId?: string | null;
}

function withAuthHeaders(options?: ApiRequestOptions): Record<string, string> {
  return authHeaders(options?.accessToken);
}

function addApiKeyHeaders(
  headers: Record<string, string>,
  apiKey?: string | null,
  apiKeyId?: string | null,
) {
  if (apiKey?.trim()) {
    headers["X-Miromind-Key"] = apiKey.trim();
  } else if (apiKeyId?.trim()) {
    headers["X-Miromind-Key-Id"] = apiKeyId.trim();
  }
}

export async function uploadPdf(
  file: File,
  apiKey?: string,
  options?: { contentDomain?: ContentDomain } & ApiRequestOptions,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("pdf", file);
  form.append("content_domain", options?.contentDomain ?? "general");
  // BYOK: pass the visitor's own MiroMind key via header. The backend will
  // 400 if neither this header nor a server-side fallback key is present.
  const headers: Record<string, string> = withAuthHeaders(options);
  addApiKeyHeaders(headers, apiKey, options?.apiKeyId);
  const resp = await fetch(`${API_BASE}/jobs`, {
    method: "POST",
    body: form,
    headers,
  });
  if (resp.status === 415) {
    throw new UnsupportedMediaTypeError();
  }
  if (resp.status === 400) {
    const text = await responseMessage(resp);
    throw new ArgusApiError(400, text || "MiroMind API key required.");
  }
  if (!resp.ok) {
    const text = await responseMessage(resp);
    throw new ArgusApiError(resp.status, text || `upload failed (${resp.status})`);
  }
  return (await resp.json()) as UploadResponse;
}

export type ContentDomain =
  | "general"
  | "academic"
  | "medical"
  | "legal"
  | "finance"
  | "technology"
  | "news"
  | "science";

export async function submitText(
  text: string,
  apiKey?: string,
  options?: { contentDomain?: ContentDomain } & ApiRequestOptions,
): Promise<UploadResponse> {
  const headers: Record<string, string> = {
    ...withAuthHeaders(options),
    "Content-Type": "application/json",
  };
  addApiKeyHeaders(headers, apiKey, options?.apiKeyId);
  const resp = await fetch(`${API_BASE}/jobs/text`, {
    method: "POST",
    body: JSON.stringify({
      text,
      auto_review: false,
      content_domain: options?.contentDomain ?? "general",
    }),
    headers,
  });
  if (resp.status === 400) {
    const msg = await responseMessage(resp);
    throw new ArgusApiError(400, msg || "MiroMind API key required.");
  }
  if (resp.status === 422) {
    throw new ArgusApiError(422, "Text too short (minimum 50 characters).");
  }
  if (!resp.ok) {
    const text = await responseMessage(resp);
    throw new ArgusApiError(resp.status, text || `submit failed (${resp.status})`);
  }
  return (await resp.json()) as UploadResponse;
}

export async function submitClaimSelection(
  jobId: string,
  selectedClaimIds: string[],
  apiKey?: string | null,
  options?: ApiRequestOptions,
): Promise<void> {
  const headers: Record<string, string> = {
    ...withAuthHeaders(options),
    "Content-Type": "application/json",
  };
  addApiKeyHeaders(headers, apiKey, options?.apiKeyId);
  const resp = await fetch(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/claims/select`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ selected_claim_ids: selectedClaimIds }),
    },
  );
  if (!resp.ok) {
    const text = await responseMessage(resp);
    throw new ArgusApiError(
      resp.status,
      text || `claim selection failed (${resp.status})`,
    );
  }
}

export async function getJob(jobId: string, options?: ApiRequestOptions): Promise<Job> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
    headers: withAuthHeaders(options),
  });
  if (resp.status === 404) {
    throw new JobNotFoundError(jobId);
  }
  if (!resp.ok) {
    throw new ArgusApiError(resp.status, `get job failed (${resp.status})`);
  }
  return (await resp.json()) as Job;
}

export async function downloadReport(
  jobId: string,
  apiKey: string | null,
  options?: ApiRequestOptions,
): Promise<Blob> {
  const headers: Record<string, string> = withAuthHeaders(options);
  addApiKeyHeaders(headers, apiKey, options?.apiKeyId);
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/report.pdf`, { headers });
  if (!resp.ok) {
    throw new ArgusApiError(resp.status, `download failed: ${resp.status}`);
  }
  return await resp.blob();
}
