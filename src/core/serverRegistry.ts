import type { ServerEntry, Session } from "../types";

const REGISTRY_KEY = "silo-webos-servers-v1";
const ACTIVE_KEY = "silo-webos-active-server-v1";

function normalize(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function serverName(url: string) {
  if (url.startsWith("/")) return "Silo development proxy";
  return new URL(url).hostname;
}

function readAll(): ServerEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: ServerEntry[]) {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(entries));
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
    const entries = readAll().filter((entry) => entry.id !== id);
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
