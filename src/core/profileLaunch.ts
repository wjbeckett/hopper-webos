export type ProfileLaunchBehavior = "automatic" | "askEveryLaunch" | "afterOneHour" | "afterTwelveHours";

export const profileLaunchChoices: Array<{ value: ProfileLaunchBehavior; label: string; detail: string; awayMs: number | null }> = [
  { value: "automatic", label: "Automatic", detail: "Use the last profile selected on this TV. A protected profile can reopen without asking for its PIN.", awayMs: null },
  { value: "askEveryLaunch", label: "Every Time", detail: "Show Who's Watching whenever you return to Silo.", awayMs: null },
  { value: "afterOneHour", label: "After 1 Hour", detail: "Show Who's Watching when you've been away from Silo for 1 hour.", awayMs: 60 * 60 * 1000 },
  { value: "afterTwelveHours", label: "After 12 Hours", detail: "Show Who's Watching when you've been away from Silo for 12 hours.", awayMs: 12 * 60 * 60 * 1000 }
];

const BEHAVIOR_KEY = "silo-webos-profile-launch";
const AWAY_KEY = "silo-webos-profile-away-since";

export function readProfileLaunchBehavior(): ProfileLaunchBehavior {
  const raw = localStorage.getItem(BEHAVIOR_KEY);
  return profileLaunchChoices.find(choice => choice.value === raw)?.value ?? "automatic";
}

export function writeProfileLaunchBehavior(behavior: ProfileLaunchBehavior) {
  localStorage.setItem(BEHAVIOR_KEY, behavior);
  if (behavior === "automatic") localStorage.removeItem(AWAY_KEY);
}

export function markBackgrounded(now = Date.now()) {
  if (readProfileLaunchBehavior() === "automatic") return;
  localStorage.setItem(AWAY_KEY, String(now));
}

export function clearBackgrounded() {
  localStorage.removeItem(AWAY_KEY);
}

function awayExpired(now: number) {
  const since = Number(localStorage.getItem(AWAY_KEY));
  if (!Number.isFinite(since) || since <= 0) return false;
  const awayMs = profileLaunchChoices.find(choice => choice.value === readProfileLaunchBehavior())?.awayMs;
  return awayMs != null && now - since >= awayMs;
}

export function requiresSelectionAtLaunch(now = Date.now()) {
  return readProfileLaunchBehavior() === "askEveryLaunch" || awayExpired(now);
}

export function requiresSelectionAfterBackground(now = Date.now()) {
  if (!localStorage.getItem(AWAY_KEY)) return false;
  return readProfileLaunchBehavior() === "askEveryLaunch" || awayExpired(now);
}
