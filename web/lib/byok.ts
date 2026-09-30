import { useSyncExternalStore } from "react";

// The visitor's own MiroMind key and model choice, held only in the browser.
// The key lives in sessionStorage for the tab session and in localStorage only
// after the visitor opts in; the claim-review resume re-sends it because the
// backend never stores a pasted key.

export const MIROMIND_MODELS = [
  { id: "mirothinker-1-7-deepresearch-mini", label: "Deep Research Mini" },
  { id: "mirothinker-1-7-deepresearch", label: "Deep Research" },
] as const;

export type MiroMindModel = (typeof MIROMIND_MODELS)[number]["id"];

export function isMiroMindModel(value: unknown): value is MiroMindModel {
  return typeof value === "string" && MIROMIND_MODELS.some((model) => model.id === value);
}

const configuredDefault = process.env.NEXT_PUBLIC_ARGUS_MIROMIND_MODEL;
export const DEFAULT_MIROMIND_MODEL: MiroMindModel = isMiroMindModel(configuredDefault)
  ? configuredDefault
  : "mirothinker-1-7-deepresearch-mini";

const KEY_STORAGE = "argus-miromind-key";
const MODEL_STORAGE = "argus-miromind-model";

// Private-mode browsers can throw on any storage access.
function read(name: string): string | null {
  try {
    return window.sessionStorage.getItem(name) ?? window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

function write(storage: Storage, name: string, value: string | null) {
  try {
    if (value) storage.setItem(name, value);
    else storage.removeItem(name);
  } catch {
    /* storage is best-effort */
  }
}

export function storedApiKey(): string | null {
  return read(KEY_STORAGE);
}

export function isApiKeyRemembered(): boolean {
  try {
    return Boolean(window.localStorage.getItem(KEY_STORAGE));
  } catch {
    return false;
  }
}

export function storeApiKey(key: string, remember: boolean) {
  write(window.sessionStorage, KEY_STORAGE, key || null);
  write(window.localStorage, KEY_STORAGE, remember && key ? key : null);
}

export function storedMiroMindModel(): MiroMindModel {
  const stored = read(MODEL_STORAGE);
  return isMiroMindModel(stored) ? stored : DEFAULT_MIROMIND_MODEL;
}

const noSubscription = () => () => {};

/** The stored model on the client; the default during server render. */
export function useStoredMiroMindModel(): MiroMindModel {
  return useSyncExternalStore(noSubscription, storedMiroMindModel, () => DEFAULT_MIROMIND_MODEL);
}

export function storeMiroMindModel(model: MiroMindModel) {
  write(window.sessionStorage, MODEL_STORAGE, model);
  write(window.localStorage, MODEL_STORAGE, model);
}
