import type { Session } from "../types";

export type BrowsePrefs = {
  sort: string;
  order: "asc" | "desc";
  filters: Record<string, string[]>;
  matchAll: boolean;
};

export function browsePrefsKey(session: Session, libraryKey: string, type?: string) {
  if (!session.profileId) return null;
  const scope = type ? `.type-${type.toLowerCase()}` : "";
  return `silo.browsePrefs.${session.serverUrl}.${session.profileId}.${libraryKey || "all"}${scope}`;
}

export function readPreserve(key: string | null) {
  if (!key) return true;
  return localStorage.getItem(`${key}.preserve`) !== "false";
}

export function writePreserve(key: string | null, preserve: boolean) {
  if (!key) return;
  localStorage.setItem(`${key}.preserve`, String(preserve));
  if (!preserve) localStorage.removeItem(`${key}.state`);
}

export function readBrowsePrefs(key: string | null): BrowsePrefs | null {
  if (!key || !readPreserve(key)) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(`${key}.state`) ?? "null") as Partial<BrowsePrefs> | null;
    if (!parsed || typeof parsed.sort !== "string") return null;
    return {
      sort: parsed.sort,
      order: parsed.order === "desc" ? "desc" : "asc",
      filters: parsed.filters && typeof parsed.filters === "object" ? parsed.filters : {},
      matchAll: parsed.matchAll !== false
    };
  } catch {
    return null;
  }
}

export function writeBrowsePrefs(key: string | null, prefs: BrowsePrefs) {
  if (!key || !readPreserve(key)) return;
  localStorage.setItem(`${key}.state`, JSON.stringify(prefs));
}
