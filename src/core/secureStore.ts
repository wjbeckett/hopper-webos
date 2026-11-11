/**
 * Keeps sign-in secrets out of readable storage.
 *
 * Each server's refresh token and profile token are encrypted with AES-GCM (WebCrypto) and
 * the result is stored in localStorage. The key is generated on the TV as non-extractable
 * and kept in IndexedDB, which can hold a CryptoKey object: its raw bytes can never be read
 * out, not even from the inspector, so a copy of localStorage alone is useless. The access
 * token is never stored; it lives in memory and is renewed from the refresh token on launch.
 *
 * What this does not do: a web app on webOS has no hardware keystore, so code running inside
 * the app can still use the key to decrypt. It protects against the stored tokens being read
 * or copied, not against the app itself being compromised.
 *
 * Reads are synchronous (the server registry is): `loadSecrets` decrypts everything once at
 * start-up, before the app renders, and the values stay in memory. Writes go to memory at
 * once and are encrypted and stored a moment later. If that write fails, `storedSecurely()`
 * turns false and the registry keeps the tokens in plain storage, as builds before this one
 * did, rather than lose the sign-in; the write is retried and the registry is told when it
 * succeeds.
 */

export type Secrets = { accessToken?: string; refreshToken?: string; profileToken?: string };
type Sealed = { iv: string; data: string };

const SEALED_KEY = "silo-webos-sealed-v1";
const DB_NAME = "hopper-keys";
const STORE = "keys";
const KEY_ID = "session-v1";

const memory = new Map<string, Secrets>();
let key: CryptoKey | null = null;
/** False where WebCrypto or IndexedDB is missing; secrets then stay in memory and in plain storage. */
let available = false;
/** False while the last encrypted write failed. */
let healthy = true;
let sealing: Promise<boolean> = Promise.resolve(true);
let sealQueued = false;
let retryTimer: number | undefined;
let retries = 0;
const RETRY_MS = 10_000;
const MAX_RETRIES = 6;
const healthListeners = new Set<() => void>();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves once the transaction has committed: a request can succeed and its transaction still abort. */
function idb<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result as T);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function loadKey(): Promise<CryptoKey> {
  const db = await openDb();
  try {
    const existing = await idb<CryptoKey | undefined>(db, "readonly", store => store.get(KEY_ID));
    if (existing) return existing;
    const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await idb(db, "readwrite", store => store.put(created, KEY_ID));
    return created;
  } finally {
    db.close();
  }
}

function readSealed(): Record<string, Sealed> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEALED_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function seal(secrets: Secrets): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ refreshToken: secrets.refreshToken, profileToken: secrets.profileToken }));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key!, plain));
  return { iv: toBase64(iv), data: toBase64(data) };
}

async function unseal(sealed: Sealed): Promise<Secrets> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv) }, key!, fromBase64(sealed.data));
  return JSON.parse(new TextDecoder().decode(plain)) as Secrets;
}

/** Encrypts what is in memory and replaces the stored copy. */
async function writeSealed() {
  const next: Record<string, Sealed> = {};
  for (const [url, secrets] of memory) {
    if (secrets.refreshToken || secrets.profileToken) next[url] = await seal(secrets);
  }
  localStorage.setItem(SEALED_KEY, JSON.stringify(next));
}

function setHealthy(next: boolean) {
  if (healthy === next) return;
  healthy = next;
  [...healthListeners].forEach(listener => listener());
}

function scheduleSeal() {
  if (!available || sealQueued) return;
  sealQueued = true;
  window.clearTimeout(retryTimer);
  retryTimer = undefined;
  sealing = sealing.then(async () => {
    sealQueued = false;
    try {
      await writeSealed();
      retries = 0;
      setHealthy(true);
      return true;
    } catch (error) {
      console.warn("[Hopper] could not store the sign-in securely; keeping it in plain storage for now", error);
      setHealthy(false);
      if (retries < MAX_RETRIES) {
        retries++;
        retryTimer = window.setTimeout(scheduleSeal, RETRY_MS);
      }
      return false;
    }
  });
}

/**
 * Loads the key and decrypts the stored secrets into memory. Call once, before anything
 * reads a session. Never rejects: on failure secrets that cannot be read are dropped, and
 * those servers ask for sign-in again.
 */
export async function loadSecrets(): Promise<void> {
  try {
    if (!window.isSecureContext || !crypto?.subtle || typeof indexedDB === "undefined") throw new Error("WebCrypto or IndexedDB is not available");
    key = await loadKey();
    available = true;
  } catch (error) {
    console.warn("[Hopper] secure storage unavailable; sign-in tokens stay in plain storage", error);
    return;
  }
  const sealed = readSealed();
  for (const [url, value] of Object.entries(sealed)) {
    try {
      memory.set(url, await unseal(value));
    } catch (error) {
      // Wrong key (IndexedDB cleared) or damaged data: this server needs a new sign-in.
      console.warn("[Hopper] could not read a stored sign-in", error);
    }
  }
}

/** True when the key loaded, so secrets can be encrypted at rest. */
export function secureStorageAvailable(): boolean {
  return available;
}

/**
 * True when the encrypted copy can be relied on. False when secure storage is unavailable or
 * the last encrypted write failed: the caller must then keep the tokens in plain storage.
 */
export function storedSecurely(): boolean {
  return available && healthy;
}

/** Called when `storedSecurely()` changes, so the registry can rewrite its entries. */
export function subscribeStorageHealth(listener: () => void): () => void {
  healthListeners.add(listener);
  return () => { healthListeners.delete(listener); };
}

export function secretsFor(url: string): Secrets | undefined {
  return memory.get(url);
}

export function setSecrets(url: string, secrets: Secrets) {
  const current = memory.get(url);
  if (current && current.accessToken === secrets.accessToken && current.refreshToken === secrets.refreshToken && current.profileToken === secrets.profileToken) return;
  const sealedChanged = !current || current.refreshToken !== secrets.refreshToken || current.profileToken !== secrets.profileToken;
  memory.set(url, { ...secrets });
  // The access token is memory only, so a change to it alone needs no write.
  if (sealedChanged) scheduleSeal();
}

/** Forgets a server's secrets. The stored copy is removed at once; that needs no encryption. */
export function clearSecrets(url: string) {
  const had = memory.delete(url);
  // Removing needs no key, so do it even when the key failed to load.
  const sealed = readSealed();
  if (url in sealed) {
    delete sealed[url];
    localStorage.setItem(SEALED_KEY, JSON.stringify(sealed));
  }
  // A write already queued would put the old copy back.
  if (had && available) scheduleSeal();
}

/** Resolves when every write so far has been tried: true if the last one was stored. */
export function secretsSettled(): Promise<boolean> {
  return sealing;
}
