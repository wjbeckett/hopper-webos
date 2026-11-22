/**
 * The screensaver's setting (#209): how many minutes without a key press before it starts, or 0
 * for off. Kept on this TV, like the other device-only choices.
 */
const STORAGE_KEY = "hopper-screensaver-v1";
export const SCREENSAVER_DELAYS = [0, 2, 5, 10, 15, 30] as const;
export const DEFAULT_SCREENSAVER_MINUTES = 5;

const listeners = new Set<() => void>();

export function screensaverMinutes(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored == null) return DEFAULT_SCREENSAVER_MINUTES;
    const minutes = Number(stored);
    return (SCREENSAVER_DELAYS as readonly number[]).includes(minutes) ? minutes : DEFAULT_SCREENSAVER_MINUTES;
  } catch {
    return DEFAULT_SCREENSAVER_MINUTES;
  }
}

export function setScreensaverMinutes(minutes: number) {
  try { localStorage.setItem(STORAGE_KEY, String(minutes)); } catch { /* Storage blocked: the default stays. */ }
  listeners.forEach(listener => listener());
}

export function subscribeScreensaver(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function screensaverLabel(minutes: number) {
  return minutes === 0 ? "Off" : `After ${minutes} minutes`;
}

/** The next slide's title corner: it alternates, so nothing stays in one place on the panel. */
export function revealCorner(slide: number): "left" | "right" {
  return slide % 2 === 0 ? "left" : "right";
}
