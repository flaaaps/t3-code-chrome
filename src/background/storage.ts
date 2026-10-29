import {
  type ConnectionAuth,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type Job,
  type PromptTemplate,
  type ServerConnection,
} from "@shared/models";

const KEYS = {
  connections: "connections",
  settings: "settings",
  templates: "customTemplates",
  jobs: "jobs",
  authKey: "authKey",
  authBlob: (id: string) => `auth:${id}`,
} as const;

async function getLocal<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function setLocal(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function loadConnections(): Promise<ServerConnection[]> {
  return (await getLocal<ServerConnection[]>(KEYS.connections)) ?? [];
}

export async function saveConnections(connections: ServerConnection[]): Promise<void> {
  await setLocal(KEYS.connections, connections);
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = (await getLocal<Partial<ExtensionSettings>>(KEYS.settings)) ?? {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await setLocal(KEYS.settings, settings);
}

export async function loadCustomTemplates(): Promise<PromptTemplate[]> {
  return (await getLocal<PromptTemplate[]>(KEYS.templates)) ?? [];
}

export async function saveCustomTemplates(templates: PromptTemplate[]): Promise<void> {
  await setLocal(KEYS.templates, templates);
}

export async function loadJobs(): Promise<Job[]> {
  return (await getLocal<Job[]>(KEYS.jobs)) ?? [];
}

export async function saveJobs(jobs: Job[]): Promise<void> {
  await setLocal(KEYS.jobs, jobs);
}

// --- Token storage -------------------------------------------------------
// Tokens are kept in chrome.storage.session for the worker's lifetime and persisted to
// chrome.storage.local encrypted with a per-install AES-GCM key. This does not stop a
// determined attacker with profile access, but it keeps tokens out of plain-text dumps.

let cachedKey: CryptoKey | undefined;

async function authKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const stored = await getLocal<number[]>(KEYS.authKey);
  let raw: Uint8Array;
  if (stored && stored.length === 32) {
    raw = new Uint8Array(stored);
  } else {
    raw = crypto.getRandomValues(new Uint8Array(32));
    await setLocal(KEYS.authKey, Array.from(raw));
  }
  cachedKey = await crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

async function encrypt(value: unknown): Promise<{ iv: number[]; data: number[] }> {
  const key = await authKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) };
}

async function decrypt<T>(blob: { iv: number[]; data: number[] }): Promise<T | undefined> {
  try {
    const key = await authKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(blob.iv) },
      key,
      new Uint8Array(blob.data),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return undefined;
  }
}

export async function loadAuth(connectionId: string): Promise<ConnectionAuth | undefined> {
  const sessionKey = KEYS.authBlob(connectionId);
  const fromSession = (await chrome.storage.session.get(sessionKey))[sessionKey] as
    | ConnectionAuth
    | undefined;
  if (fromSession) return fromSession;
  const blob = await getLocal<{ iv: number[]; data: number[] }>(sessionKey);
  if (!blob) return undefined;
  const auth = await decrypt<ConnectionAuth>(blob);
  if (auth) await chrome.storage.session.set({ [sessionKey]: auth });
  return auth;
}

export async function saveAuth(connectionId: string, auth: ConnectionAuth): Promise<void> {
  const sessionKey = KEYS.authBlob(connectionId);
  await chrome.storage.session.set({ [sessionKey]: auth });
  await setLocal(sessionKey, await encrypt(auth));
}

export async function clearAuth(connectionId: string): Promise<void> {
  const sessionKey = KEYS.authBlob(connectionId);
  await chrome.storage.session.remove(sessionKey);
  await chrome.storage.local.remove(sessionKey);
}

export async function getSessionValue<T>(key: string): Promise<T | undefined> {
  return (await chrome.storage.session.get(key))[key] as T | undefined;
}

export async function setSessionValue(key: string, value: unknown): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}
