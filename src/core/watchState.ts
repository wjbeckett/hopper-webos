import { useEffect, useRef } from "react";
import type { SiloItem } from "../types";

type Listener = (item: SiloItem) => void;

const listeners = new Set<Listener>();

export function publishWatchState(item: SiloItem) {
  for (const listener of [...listeners]) listener({ ...item });
}

export function subscribeWatchState(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
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

let refreshTimer: number | undefined;
let refreshInFlight = false;
let refreshQueued = false;

function scheduleWatchRefresh(run: () => void | Promise<void>) {
  if (refreshTimer != null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }
    refreshInFlight = true;
    Promise.resolve(run()).finally(() => {
      refreshInFlight = false;
      if (refreshQueued) {
        refreshQueued = false;
        scheduleWatchRefresh(run);
      }
    });
  }, 300);
}

/** Debounced (300ms), single-flight rail refresh driven by the watch bus. */
export function useWatchStateRefresh(refresh: () => void | Promise<void>) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });
  useEffect(() => subscribeWatchState(() => scheduleWatchRefresh(() => refreshRef.current())), []);
}
