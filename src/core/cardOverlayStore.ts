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
  }).catch(() => undefined);
}

export function useCardOverlays(): State {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state
  );
}
