const LOCAL_SETTINGS_STORAGE = "silo-webos-local-settings";

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
