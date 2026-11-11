import type { ServerEntry, Session } from "../types";
import { clearSecrets, secretsFor, secretsSettled, secureStorageAvailable, setSecrets } from "./secureStore";

const REGISTRY_KEY = "silo-webos-servers-v1";
const ACTIVE_KEY = "silo-webos-active-server-v1";

function normalize(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function serverName(url: string) {
  if (url.startsWith("/")) return "Silo development proxy";
  return new URL(url).hostname;
}

/** What is stored for each server: the session without its tokens when secure storage is available. */
function readStored(): ServerEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Saved servers with their sessions complete. The tokens come from memory (see
 * core/secureStore). A session whose refresh token could not be read is left out, so that
 * server asks for sign-in again.
 */
function readAll(): ServerEntry[] {
  return readStored().map((entry) => {
    if (!entry.session) return entry;
    const secrets = secretsFor(entry.url);
    // Plain tokens are still on the entry where secure storage is unavailable.
    const session: Session = { ...entry.session, ...secrets, accessToken: secrets?.accessToken ?? entry.session.accessToken ?? "" };
    if (!session.refreshToken && !session.accessToken) return { ...entry, session: undefined };
    return { ...entry, session };
  });
}

function writeAll(entries: ServerEntry[]) {
  const stored = entries.map((entry) => {
    if (!entry.session) {
      clearSecrets(entry.url);
      return entry;
    }
    const { accessToken, refreshToken, profileToken, ...rest } = entry.session;
    setSecrets(entry.url, { accessToken, refreshToken, profileToken });
    if (!secureStorageAvailable()) return entry;
    return { ...entry, session: { ...rest, accessToken: "" } };
  });
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(stored));
}

/**
 * Moves sign-ins saved by older builds, with tokens in plain text, into secure storage. The
 * plain copy is removed only once the encrypted one is stored, so a power cut in between
 * cannot lose the sign-in. Run once at start-up, after secrets are loaded.
 */
export async function migratePlainSessions(): Promise<void> {
  if (!secureStorageAvailable()) return;
  const stored = readStored();
  const plain = stored.filter(entry => entry.session && (entry.session.refreshToken || entry.session.profileToken || entry.session.accessToken));
  if (!plain.length) return;
  for (const entry of plain) {
    const { accessToken, refreshToken, profileToken } = entry.session!;
    // The plain copy is the newer one if both exist.
    setSecrets(entry.url, { accessToken, refreshToken, profileToken });
  }
  await secretsSettled();
  writeAll(readAll());
}

export const serverRegistry = {
  all(): ServerEntry[] {
    return readAll().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  },

  active(): ServerEntry | null {
    const id = localStorage.getItem(ACTIVE_KEY);
    return readAll().find((entry) => entry.id === id) ?? null;
  },

  upsert(url: string, name?: string): ServerEntry {
    const normalized = normalize(url);
    const entries = readAll();
    let entry = entries.find((item) => item.url === normalized);

    if (!entry) {
      entry = {
        id: crypto.randomUUID?.() ?? `srv-${Date.now()}`,
        name: name || serverName(normalized),
        url: normalized,
        lastUsedAt: Date.now()
      };
      entries.push(entry);
    } else {
      entry.name = name || entry.name;
      entry.lastUsedAt = Date.now();
    }

    writeAll(entries);
    localStorage.setItem(ACTIVE_KEY, entry.id);
    return entry;
  },

  saveSession(session: Session) {
    const entry = this.upsert(session.serverUrl);
    const entries = readAll();
    const index = entries.findIndex((item) => item.id === entry.id);
    entries[index] = { ...entries[index], session, lastUsedAt: Date.now() };
    writeAll(entries);
    localStorage.setItem(ACTIVE_KEY, entry.id);
  },

  clearSession(serverUrl: string) {
    const normalized = normalize(serverUrl);
    const entries = readAll().map((entry) =>
      entry.url === normalized ? { ...entry, session: undefined } : entry
    );
    writeAll(entries);
  },

  remove(id: string) {
    const all = readAll();
    all.filter((entry) => entry.id === id).forEach((entry) => clearSecrets(entry.url));
    const entries = all.filter((entry) => entry.id !== id);
    writeAll(entries);
    if (localStorage.getItem(ACTIVE_KEY) === id) {
      localStorage.removeItem(ACTIVE_KEY);
    }
  },

  activate(id: string) {
    const entries = readAll();
    const entry = entries.find((item) => item.id === id);
    if (!entry) return null;
    entry.lastUsedAt = Date.now();
    writeAll(entries);
    localStorage.setItem(ACTIVE_KEY, id);
    return entry;
  }
};
