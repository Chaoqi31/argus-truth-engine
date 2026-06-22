"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  uploadPdf,
  submitText,
  UnsupportedMediaTypeError,
  ArgusApiError,
} from "@/lib/api";
import { useArgusStore } from "@/lib/store";
import { ArgusHeader } from "@/components/argus-header";
import { ApiKeyInput } from "@/components/api-key-input";
import { PdfUploadDropzone } from "@/components/pdf-upload-dropzone";
import { AuthButton } from "@/components/auth-button";
import {
  createSavedApiKey,
  listSavedApiKeys,
  type SavedApiKey,
} from "@/lib/account";
import { useAuthSession } from "@/lib/use-auth-session";

export function AuditInputPage({ signedInNotice }: { signedInNotice?: ReactNode }) {
  const router = useRouter();
  const auth = useAuthSession();
  const resetLive = useArgusStore((s) => s.resetLive);
  const clearStore = useArgusStore((s) => s.clear);
  const [apiKey, setApiKey] = useState("");
  const [savedKeys, setSavedKeys] = useState<SavedApiKey[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("paste");
  const [saveKeyToAccount, setSaveKeyToAccount] = useState(false);
  const [inputMode, setInputMode] = useState<"text" | "pdf">("text");
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState<"upload" | "sample" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.accessToken) {
      queueMicrotask(() => {
        setSavedKeys([]);
        setSelectedKeyId("paste");
      });
      return;
    }
    let active = true;
    listSavedApiKeys(auth.accessToken)
      .then((keys) => {
        if (!active) return;
        setSavedKeys(keys);
        const defaultKey = keys.find((key) => key.is_default) ?? keys[0];
        if (defaultKey) setSelectedKeyId(defaultKey.id);
      })
      .catch(() => {
        if (active) setSavedKeys([]);
      });
    return () => {
      active = false;
    };
  }, [auth.accessToken]);

  const usingSavedKey = selectedKeyId !== "paste";
  const hasRunnableKey = usingSavedKey || apiKey.trim().length > 0;

  const submitOptions = async () => {
    let apiKeyId = usingSavedKey ? selectedKeyId : null;
    let rawApiKey = usingSavedKey ? undefined : apiKey;
    if (
      auth.accessToken &&
      !usingSavedKey &&
      saveKeyToAccount &&
      apiKey.trim()
    ) {
      const saved = await createSavedApiKey(auth.accessToken, apiKey.trim());
      setSavedKeys((prev) => [saved, ...prev.filter((key) => key.id !== saved.id)]);
      setSelectedKeyId(saved.id);
      apiKeyId = saved.id;
      rawApiKey = undefined;
      setSaveKeyToAccount(false);
    }
    return {
      rawApiKey,
      options:
        auth.accessToken || apiKeyId
          ? { accessToken: auth.accessToken, apiKeyId }
          : undefined,
    };
  };

  const trySample = () => {
    setLoading("sample");
    setError(null);
    clearStore();
    router.push("/audit?demo=1");
  };

  const prepareSampleLink = () => {
    setError(null);
    clearStore();
  };

  const onSubmitText = async () => {
    if (!hasRunnableKey) { setError("Please choose or paste your MiroMind API key first."); return; }
    if (textInput.trim().length < 50) { setError("Text must be at least 50 characters."); return; }
    setLoading("upload");
    setError(null);
    try {
      const { rawApiKey, options } = await submitOptions();
      const { job_id } = options
        ? await submitText(textInput, rawApiKey, options)
        : await submitText(textInput, rawApiKey);
      resetLive();
      router.push(`/audit?id=${encodeURIComponent(job_id)}&mode=text`);
    } catch (e) {
      if (e instanceof ArgusApiError) setError(`API error: ${e.message}`);
      else if (e instanceof Error) setError(`Could not reach the Argus API. (${e.message})`);
      else setError(String(e));
      setLoading(null);
    }
  };

  const onPicked = async (file: File) => {
    const looksLikePdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!looksLikePdf) {
      setError("Only PDF files are supported.");
      return;
    }
    if (!hasRunnableKey) { setError("Please choose or paste your MiroMind API key first."); return; }
    setLoading("upload");
    setError(null);
    try {
      const { rawApiKey, options } = await submitOptions();
      const { job_id } = options
        ? await uploadPdf(file, rawApiKey, options)
        : await uploadPdf(file, rawApiKey);
      resetLive();
      router.push(`/audit?id=${encodeURIComponent(job_id)}`);
    } catch (e) {
      if (e instanceof UnsupportedMediaTypeError) setError("Only PDF files are supported.");
      else if (e instanceof ArgusApiError) setError(`API error: ${e.message}`);
      else if (e instanceof Error) setError(`Could not reach the Argus API. (${e.message})`);
      else setError(String(e));
      setLoading(null);
    }
  };

  return (
    <>
      <ArgusHeader
        rightSlot={
          <div className="flex items-center gap-2">
            <Link
              href="/audit?demo=1"
              onClick={prepareSampleLink}
              className="inline-flex items-center justify-center rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              See a sample audit
            </Link>
            <AuthButton next="/audit" />
          </div>
        }
      />
      {signedInNotice}
      <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center px-6 py-14 md:py-20">
        <div className="w-full max-w-2xl">
          <div className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Audit AI-generated reports before sign-off
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Verify research, legal, and governance documents before they reach
              clients, regulators, or investment committees.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {["Investment research", "Legal & compliance", "AI governance"].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background p-6 shadow-[var(--shadow-card)]">
            {savedKeys.length > 0 && (
              <div className="mb-3 flex flex-col gap-1.5">
                <label
                  htmlFor="saved-miromind-key"
                  className="text-xs font-medium text-muted-foreground"
                >
                  MiroMind API key
                </label>
                <select
                  id="saved-miromind-key"
                  value={selectedKeyId}
                  onChange={(e) => {
                    setSelectedKeyId(e.target.value);
                    setError(null);
                  }}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {savedKeys.map((key) => (
                    <option key={key.id} value={key.id}>
                      {key.label} · ****{key.last4}
                    </option>
                  ))}
                  <option value="paste">Paste a different key</option>
                </select>
              </div>
            )}

            {selectedKeyId === "paste" && (
              <>
                <ApiKeyInput value={apiKey} onChange={setApiKey} />
                {auth.user && (
                  <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={saveKeyToAccount}
                      onChange={(e) => setSaveKeyToAccount(e.target.checked)}
                      className="size-3.5 rounded border-border"
                    />
                    <span>Save this key to my account for future audits</span>
                  </label>
                )}
              </>
            )}

            <div className="mt-4 flex w-full rounded-lg border border-border bg-muted/50 p-0.5">
              <button
                type="button"
                onClick={() => { setInputMode("text"); setError(null); }}
                className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${inputMode === "text" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Paste Text
              </button>
              <button
                type="button"
                onClick={() => { setInputMode("pdf"); setError(null); }}
                className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${inputMode === "pdf" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Upload PDF
              </button>
            </div>

            {inputMode === "text" && (
              <div className="mt-4 flex flex-col gap-3">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={loading !== null}
                  placeholder="Paste an AI-generated research memo, legal note, compliance summary, or market analysis..."
                  className="h-48 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs ${
                      textInput.trim().length < 50 ? "text-warning-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {textInput.trim().length < 50
                      ? `${textInput.length.toLocaleString()} / 50 characters minimum`
                      : `${textInput.length.toLocaleString()} characters`}
                  </span>
                  <button
                    type="button"
                    onClick={onSubmitText}
                    disabled={loading !== null || textInput.trim().length < 50}
                    className="cursor-pointer rounded-[12px] bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#5741d8] disabled:pointer-events-none disabled:opacity-50"
                  >
                    {loading === "upload" ? "Submitting…" : "Run document audit →"}
                  </button>
                </div>
              </div>
            )}

            {inputMode === "pdf" && (
              <div className="mt-4">
                <PdfUploadDropzone
                  busy={loading === "upload"}
                  disabled={loading !== null}
                  onPicked={onPicked}
                />
              </div>
            )}

            {error && (
              <p role="alert" aria-live="assertive" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground">
                {error}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary-soft/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-medium text-foreground">No API key ready?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Open the legal filing demo and inspect the full audit workflow.
              </p>
            </div>
            <button
              type="button"
              onClick={trySample}
              disabled={loading !== null}
              className="inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-muted disabled:opacity-50"
            >
              {loading === "sample" ? "Loading…" : "See a sample audit"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
