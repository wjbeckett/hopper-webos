import { useEffect, useRef } from "react";
import type { SiloItem } from "../types";

type Listener = (item: SiloItem) => void;

const listeners = new Set<Listener>();
const refreshListeners = new Set<() => void>();

export function publishWatchState(item: SiloItem) {
  for (const listener of [...listeners]) listener({ ...item });
}

export function publishRailsChanged() {
  for (const listener of [...refreshListeners]) listener();
}

export function subscribeWatchState(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function subscribeRailsChanged(listener: () => void) {
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
    const run = () => {
      if (busyRef.current) {
        queuedRef.current = true;
        return;
      }
      busyRef.current = true;
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
    const unsubscribeSignals = subscribeRailsChanged(() => schedule(signalTimer, 2_000, next => { signalTimer = next; }));
    if (pollMs) {
      const tick = () => {
        if (document.visibilityState === "visible") run();
      };
      pollRef.current = window.setInterval(tick, pollMs);
    }
    return () => {
      unsubscribeBus();
      unsubscribeSignals();
      if (busTimer !== undefined) window.clearTimeout(busTimer);
      if (signalTimer !== undefined) window.clearTimeout(signalTimer);
      if (pollRef.current !== undefined) window.clearInterval(pollRef.current);
    };
  }, [debounceMs, pollMs]);
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
