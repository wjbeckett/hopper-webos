import { getDeviceId } from "../platform/device";
import type { Session } from "../types";
import { ensureAccessToken, refreshSession, v2Url } from "./silo";

export type PlaybackLearnedLimit = { kbps: number; observed_at: string; expires_at: string };
export type PlaybackSample = { kbps: number; measured_at: string };
export type PlaybackProbeReading = { kbps: number; lower_bound: boolean; measured_at: string; transport: string };
export type PlaybackConnection = {
  connection: string;
  learned_limit: PlaybackLearnedLimit | null;
  playback_sample?: PlaybackSample;
  probe?: PlaybackProbeReading;
  auto_budget_kbps?: number;
};

const authHeaders = (session: Session): Record<string, string> => ({
  Accept: "application/json",
  Authorization: `Bearer ${session.accessToken}`,
  ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
  ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {}),
  "X-Silo-Device-Id": getDeviceId()
});

async function exchange(session: Session, path: string, init: RequestInit): Promise<Response> {
  await ensureAccessToken(session);
  let response = await fetch(v2Url(session, path), { ...init, headers: { ...authHeaders(session), ...(init.headers as Record<string, string> | undefined) } });
  if (response.status === 401 && session.refreshToken && !path.startsWith("/auth")) {
    await refreshSession(session);
    response = await fetch(v2Url(session, path), { ...init, headers: { ...authHeaders(session), ...(init.headers as Record<string, string> | undefined) } });
  }
  return response;
}

export async function getPlaybackConnection(session: Session): Promise<PlaybackConnection> {
  const response = await exchange(session, "/playback/connection", {});
  if (!response.ok) throw new Error(`playback/connection: ${response.status}`);
  return response.json() as Promise<PlaybackConnection>;
}

export async function resetLearnedLimit(session: Session): Promise<void> {
  const response = await exchange(session, "/playback/connection/learned-limit", { method: "DELETE" });
  if (!response.ok && response.status !== 204) throw new Error(`learned-limit: ${response.status}`);
}

const PROBE_BYTES = 16_000_000;
const PROBE_MAX_MS = 10_000;

export type SpeedTestResult = { kbps: number; saved: boolean };

/**
 * Downloads the server's probe payload, times it, and reports the result. `manual` is false for
 * the automatic test the app runs in the background (core/bandwidthProbe).
 */
export async function runSpeedTest(session: Session, manual = true): Promise<SpeedTestResult> {
  const started = performance.now();
  const response = await exchange(session, `/playback/bandwidth-probe?size=${PROBE_BYTES}`, {});
  if (!response.ok || !response.body) throw new Error(`bandwidth-probe: ${response.status}`);
  const reader = response.body.getReader();
  let bytes = 0;
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, PROBE_MAX_MS);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      bytes += value.byteLength;
      if (performance.now() - started >= PROBE_MAX_MS) { void reader.cancel().catch(() => {}); break; }
    }
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Math.max(1, performance.now() - started);
  if (!bytes) throw new Error("bandwidth-probe: no bytes");
  const kbps = Math.round((bytes * 8) / (durationMs / 1000) / 1000);
  const report = {
    kbps: Math.min(1_000_000, Math.max(100, kbps)),
    bytes,
    duration_ms: Math.round(durationMs),
    transport: "other",
    manual,
    lower_bound: bytes < PROBE_BYTES && durationMs < PROBE_MAX_MS ? false : bytes < PROBE_BYTES
  };
  let saved = true;
  const posted = await exchange(session, "/playback/bandwidth-probe/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report)
  });
  if (!posted.ok && posted.status !== 204) saved = false;
  return { kbps, saved };
}
