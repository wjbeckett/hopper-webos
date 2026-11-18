import { useSyncExternalStore } from "react";
import { getCardOverlaySettings } from "../api/settings";
import type { Session } from "../types";
import { resolveOverlayPrefs, type CardOverlayPrefs } from "./cardOverlays";

/**
 * The card overlay settings in force (#175), read once per server and profile and shared by every
 * card: no card makes a request of its own. Until they arrive (or if they can't be read) no
 * badges are drawn.
 */
type State = { enabled: boolean; prefs: CardOverlayPrefs | null };
let state: State = { enabled: false, prefs: null };
let loadedFor = "";
const RETRY_MS = 30_000;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function loadCardOverlays(session: Session) {
  const key = `${session.serverUrl}|${session.profileId ?? ""}`;
  if (loadedFor === key) return;
  loadedFor = key;
  set({ enabled: false, prefs: null });
  void getCardOverlaySettings(session).then(settings => {
    if (loadedFor !== key) return;
    set({ enabled: settings.enabled, prefs: resolveOverlayPrefs(settings.profileValue, settings.serverDefaults) });
  }).catch(() => {
    // Unreadable now (the server didn't answer): try again in a while, so badges don't stay off
    // until the profile changes.
    if (loadedFor !== key) return;
    loadedFor = "";
    window.setTimeout(() => { if (!loadedFor) loadCardOverlays(session); }, RETRY_MS);
  });
}

/**
 * The profile turned badges on or off in Hopper's Settings (#175): cards follow at once. Turning
 * them on before the document was read reads it now.
 */
export function setCardOverlaysEnabled(session: Session, enabled: boolean) {
  if (enabled && !state.prefs) {
    loadedFor = "";
    loadCardOverlays(session);
    return;
  }
  set({ ...state, enabled });
}

export function useCardOverlays(): State {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state
  );
}
