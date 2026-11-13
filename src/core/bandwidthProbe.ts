import { bandwidthProbeSettings } from "../api/playback";
import { runSpeedTest } from "../api/playbackConnection";
import type { Session } from "../types";

/**
 * The automatic speed test, as Android's BandwidthProbeScheduler runs it, so a playback start can
 * tell Silo how fast the connection is and get the right quality from the first frame
 * (`bandwidth_estimate_kbps`, source `probe`). Without it a start on a slow link plays the source
 * and waits for the buffering controller to lower it (core/bufferingQuality).
 *
 * - It runs PROBE_START_DELAY_MS after the app has a sign-in, never while a title plays or within
 *   PLAYBACK_START_QUIET_MS of a playback start, and not when the server turned automatic tests
 *   off (`bandwidth_probe_automatic`).
 * - A reading stands for the server's `bandwidth_probe_max_age_seconds`, or a week, per server.
 *   It is kept in localStorage so a relaunch does not test again.
 */
const PROBE_START_DELAY_MS = 5_000;
const PLAYBACK_START_QUIET_MS = 60_000;
const DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "hopper-bandwidth-probe-v1";

type Reading = { kbps: number; at: number; lifetimeMs: number };

let lastPlaybackStart = Number.NEGATIVE_INFINITY;
let timer: number | undefined;
let running = false;

function readAll(): Record<string, Reading> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Reading>; } catch { return {}; }
}

function store(serverUrl: string, reading: Reading) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [serverUrl]: reading })); } catch { /* storage full or blocked: the next launch tests again */ }
}

/** The current reading for this server, or null when there is none or it is too old. */
export function freshProbeKbps(session: Session): number | null {
  const reading = readAll()[session.serverUrl];
  if (!reading || Date.now() - reading.at > reading.lifetimeMs) return null;
  return reading.kbps;
}

/** A playback start: the test holds off while media is still loading. */
export function notePlaybackStarted() { lastPlaybackStart = performance.now(); }

const playing = () => document.querySelector(".player-shell") != null;

/** Schedules the automatic test for this sign-in, when the reading is missing or too old. */
export function scheduleBandwidthProbe(session: Session) {
  window.clearTimeout(timer);
  if (freshProbeKbps(session) != null) return;
  const attempt = async () => {
    if (running || freshProbeKbps(session) != null) return;
    if (playing() || performance.now() - lastPlaybackStart < PLAYBACK_START_QUIET_MS) {
      timer = window.setTimeout(() => void attempt(), PLAYBACK_START_QUIET_MS);
      return;
    }
    running = true;
    try {
      const settings = await bandwidthProbeSettings(session);
      if (!settings.automatic) return;
      const result = await runSpeedTest(session, false);
      const lifetimeMs = settings.maxAgeSeconds != null && settings.maxAgeSeconds > 0 ? settings.maxAgeSeconds * 1000 : DEFAULT_LIFETIME_MS;
      store(session.serverUrl, { kbps: result.kbps, at: Date.now(), lifetimeMs });
      console.info("[Hopper] automatic speed test", { kbps: result.kbps, saved: result.saved });
    } catch (error) {
      console.warn("[Hopper] automatic speed test failed", error);
    } finally {
      running = false;
    }
  };
  timer = window.setTimeout(() => void attempt(), PROBE_START_DELAY_MS);
}
