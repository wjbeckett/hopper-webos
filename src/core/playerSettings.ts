/** localStorage key for device-local settings (shared with the Settings screen). */
export const LOCAL_SETTINGS_STORAGE = "silo-webos-local-settings";

export type IntroSkipMode = "never" | "ask" | "always";
export type MarkerAction = "ignore" | "offer" | "skip";

export function markerAction(kind: "intro" | "credits" | "recap", introMode: IntroSkipMode, autoSkipCredits: boolean): MarkerAction {
  if (kind === "intro") return introMode === "never" ? "ignore" : introMode === "always" ? "skip" : "offer";
  if (kind === "credits" && autoSkipCredits) return "skip";
  return "offer";
}

export function resumePositionWithRewind(position: number | undefined, rewindSeconds: number, explicitStartOver = false) {
  if (position == null || !Number.isFinite(position) || position <= 0 || explicitStartOver) return position;
  const rewind = Number.isFinite(rewindSeconds) ? Math.max(0, rewindSeconds) : 0;
  return Math.max(0, position - rewind);
}

export function localResumeRewindSeconds() {
  try {
    const values = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_STORAGE) ?? "{}");
    const value = Number(values?.["player.resume_rewind_seconds"]);
    return Number.isFinite(value) && value >= 0 ? Math.min(60, value) : 7;
  } catch {
    return 7;
  }
}

export function localPassOutThreshold() {
  try {
    const values = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_STORAGE) ?? "{}");
    const value = Number(values?.["player.passout_threshold"]);
    return Number.isFinite(value) && value >= 0 ? value : 3;
  } catch {
    return 3;
  }
}

function readLocal(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(LOCAL_SETTINGS_STORAGE) ?? "{}")?.[key]; } catch { return undefined; }
}

function writeLocal(key: string, value: unknown) {
  try {
    const values = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_STORAGE) ?? "{}");
    const next = values && typeof values === "object" && !Array.isArray(values) ? values : {};
    next[key] = value;
    localStorage.setItem(LOCAL_SETTINGS_STORAGE, JSON.stringify(next));
  } catch { /* Keep the setting device-local. */ }
}

export function localHdrEnabled() {
  const value = readLocal("player.hdr_enabled");
  return typeof value === "boolean" ? value : true;
}

export function setLocalHdrEnabled(value: boolean) {
  writeLocal("player.hdr_enabled", value);
}

export function localDolbyVisionEnabled() {
  const value = readLocal("player.dolby_vision_enabled");
  return typeof value === "boolean" ? value : true;
}

export function setLocalDolbyVisionEnabled(value: boolean) {
  writeLocal("player.dolby_vision_enabled", value);
}

export function displaySupportsHdr() {
  try { return typeof matchMedia === "function" && matchMedia("(dynamic-range: high)").matches; } catch { return false; }
}

function clampedMs(key: string, limit: number) {
  const value = Number(readLocal(key));
  return Number.isFinite(value) ? Math.max(-limit, Math.min(limit, Math.round(value))) : 0;
}

export const AUDIO_SYNC_KEY = "player.audio_sync_ms";
export const SUBTITLE_SYNC_KEY = "player.subtitle_sync_ms";
export const localAudioSyncMs = () => Math.max(0, clampedMs(AUDIO_SYNC_KEY, 1000));
export const localSubtitleSyncMs = () => clampedMs(SUBTITLE_SYNC_KEY, 2000);
export const setLocalAudioSyncMs = (value: number) => writeLocal(AUDIO_SYNC_KEY, value);
export const setLocalSubtitleSyncMs = (value: number) => writeLocal(SUBTITLE_SYNC_KEY, value);

export function delayLabel(valueMs: number) {
  return valueMs > 0 ? `+${valueMs} ms` : valueMs < 0 ? `\u2212${-valueMs} ms` : "0 ms";
}
