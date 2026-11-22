import { useEffect, useRef } from "react";
import type { SiloItem } from "../types";
import { invalidateWatchDetail } from "../api/playback";

type Listener = (item: SiloItem) => void;

const listeners = new Set<Listener>();
const refreshListeners = new Set<(kind: RailsChange) => void>();

/** "catch-up": the events socket reconnected and asks for a read in case something changed meanwhile. */
export type RailsChange = "catch-up" | "change";
/** A catch-up this soon after a read has started is skipped: that read already covers it (#217). */
export const CATCH_UP_GRACE_MS = 10_000;

export function publishWatchState(item: SiloItem) {
  // The item's position or watched flag changed: its cached /watch response is stale now.
  invalidateWatchDetail(item.Id);
  if (item.SeriesId) invalidateWatchDetail(item.SeriesId);
  for (const listener of [...listeners]) listener({ ...item });
}

/**
 * The player's stop for these titles has landed (#165): the server's resume point and watched
 * state are final now, so pages showing them read them again.
 */
const settledListeners = new Set<(ids: string[]) => void>();

export function publishPlaybackSettled(ids: string[]) {
  for (const listener of [...settledListeners]) listener(ids);
}

export function subscribePlaybackSettled(listener: (ids: string[]) => void) {
  settledListeners.add(listener);
  return () => { settledListeners.delete(listener); };
}

export function publishRailsChanged(kind: RailsChange = "change") {
  for (const listener of [...refreshListeners]) listener(kind);
}

export function subscribeWatchState(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function subscribeRailsChanged(listener: (kind: RailsChange) => void) {
  refreshListeners.add(listener);
  return () => { refreshListeners.delete(listener); };
}

export function useWatchStateRefresh(refresh: () => unknown, debounceMs = 300, pollMs?: number) {
  const busyRef = useRef(false);
  const queuedRef = useRef(false);
  const pollRef = useRef<number | undefined>(undefined);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    /** When the last read started, so a reconnect's catch-up right after it can be skipped (#217). */
    let lastRunAt = -Infinity;
    const run = () => {
      if (busyRef.current) {
        queuedRef.current = true;
        return;
      }
      busyRef.current = true;
      lastRunAt = Date.now();
      Promise.resolve(refreshRef.current()).catch(() => undefined).finally(() => {
        busyRef.current = false;
        if (queuedRef.current) {
          queuedRef.current = false;
          run();
        }
      });
    };
    const schedule = (timer: number | undefined, delay: number, set: (next: number | undefined) => void) => {
      if (timer !== undefined) window.clearTimeout(timer);
      set(window.setTimeout(() => {
        set(undefined);
        run();
      }, delay));
    };
    let busTimer: number | undefined;
    let signalTimer: number | undefined;
    const unsubscribeBus = subscribeWatchState(() => schedule(busTimer, debounceMs, next => { busTimer = next; }));
    const unsubscribeSignals = subscribeRailsChanged(kind => {
      // Coming back to the app reads at once (below) and the socket reconnects a few seconds later;
      // its catch-up would read everything a second time.
      if (kind === "catch-up" && Date.now() - lastRunAt < CATCH_UP_GRACE_MS) return;
      schedule(signalTimer, 2_000, next => { signalTimer = next; });
    });
    // Coming back to the app (#205): the poll skipped while it was hidden, so read again now
    // rather than up to a poll later, as Android TV does when its Home returns.
    const onVisible = () => {
      if (pollMs && document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (pollMs) {
      const tick = () => {
        if (document.visibilityState === "visible") run();
      };
      pollRef.current = window.setInterval(tick, pollMs);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribeBus();
      unsubscribeSignals();
      if (busTimer !== undefined) window.clearTimeout(busTimer);
      if (signalTimer !== undefined) window.clearTimeout(signalTimer);
      if (pollRef.current !== undefined) window.clearInterval(pollRef.current);
    };
  }, [debounceMs, pollMs]);
}

/** The item with the server's user state, which replaces any local guess (none: not started). */
export function applyServerUserData(item: SiloItem, fresh: SiloItem): SiloItem {
  return { ...item, UserData: { IsFavorite: item.UserData?.IsFavorite, InWatchlist: item.UserData?.InWatchlist, Played: false, PlaybackPositionTicks: 0, PlayedPercentage: 0, ...fresh.UserData } };
}

export function applyWatchedState(item: SiloItem, watched: boolean): SiloItem {
  return {
    ...item,
    UserData: { ...item.UserData, Played: watched, PlayedPercentage: watched ? 100 : 0, PlaybackPositionTicks: watched ? 0 : item.UserData?.PlaybackPositionTicks }
  };
}

export function applyResumeState(item: SiloItem, positionSeconds: number): SiloItem {
  const duration = (item.RunTimeTicks ?? 0) / 10_000_000;
  const percent = duration > 0 ? Math.max(0, Math.min(100, (positionSeconds / duration) * 100)) : 0;
  return {
    ...item,
    UserData: { ...item.UserData, Played: false, PlaybackPositionTicks: Math.round(positionSeconds * 10_000_000), PlayedPercentage: percent }
  };
}
