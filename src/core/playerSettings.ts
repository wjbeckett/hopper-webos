const LOCAL_SETTINGS_STORAGE = "silo-webos-local-settings";

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
