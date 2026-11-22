/**
 * The server's accent colour (#201), set by the admin and read from the public branding
 * document. Hopper uses it for marks (progress, the On state, ticks) and for a soft glow behind
 * the screens (#202); focus stays white. The colour maths follows the web client
 * (`web/src/lib/accentColor.ts` in silo-server).
 */

/** The lightest panel a mark is drawn on: a ticked row in a Settings picker (white at 14% over the picker). */
const MARK_PANEL = "#3c3c3e";
/** Marks include short labels (a toggle's "On"), so they need text contrast. */
const MIN_MARK_CONTRAST = 4.5;
const STORAGE_KEY = "hopper-accent-v1";

/** `#rgb` or `#rrggbb` as lowercase `#rrggbb`, else null (the setting is free text). */
export function normalizeHex(color: unknown): string | null {
  if (typeof color !== "string") return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  return digits.length === 3 ? `#${[...digits].map(digit => digit + digit).join("")}` : `#${digits}`;
}

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function relativeLuminance(hex: string) {
  const [r, g, b] = channels(hex).map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function mixWithWhite(hex: string, amount: number) {
  return `#${channels(hex).map(c => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** The accent as a mark on Hopper's dark panels: unchanged when it reads there, else lightened just enough. */
export function markColour(hex: string) {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixWithWhite(hex, step / 20);
    if (contrastRatio(candidate, MARK_PANEL) >= MIN_MARK_CONTRAST) return candidate;
  }
  return "#ffffff";
}

/** A soft, static glow in the accent: top left, with a fainter echo bottom right. */
export function glowImage(hex: string) {
  const [r, g, b] = channels(hex);
  return `radial-gradient(1500px 900px at 0 0, rgba(${r},${g},${b},.16), rgba(${r},${g},${b},0) 70%), `
    + `radial-gradient(1200px 800px at 100% 100vh, rgba(${r},${g},${b},.07), rgba(${r},${g},${b},0) 70%)`;
}

/** The CSS variables for an accent, or null for none (or one that isn't a hex colour). */
export function accentVariables(accent: unknown): Record<string, string> | null {
  const hex = normalizeHex(accent);
  return hex ? { "--server-accent": markColour(hex), "--server-accent-glow": glowImage(hex) } : null;
}

export function applyAccent(accent: unknown) {
  const root = document.documentElement;
  const variables = accentVariables(accent);
  for (const name of ["--server-accent", "--server-accent-glow"]) {
    if (variables) root.style.setProperty(name, variables[name]);
    else root.style.removeProperty(name);
  }
  // Accented labels drop the dimming the white ones have, which would take them under 4.5:1.
  if (variables) root.dataset.accent = "true";
  else delete root.dataset.accent;
}

function readStore(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch { return {}; }
}

/** The accent last seen for a server, so a launch paints it at once instead of after the request. */
export function cachedAccent(serverUrl: string): string | null {
  return normalizeHex(readStore()[serverUrl]);
}

export function rememberAccent(serverUrl: string, accent: unknown) {
  const store = readStore();
  const hex = normalizeHex(accent);
  if (hex) store[serverUrl] = hex; else delete store[serverUrl];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* Storage full or blocked: the accent still applies this launch. */ }
}

/**
 * A profile's own accent on this TV (#201): the server's colour, none, or one of a few presets.
 * Silo has no profile accent setting since themes were retired, so the choice stays on this TV
 * and doesn't follow the profile to other devices.
 */
export const ACCENT_PRESETS: ReadonlyArray<{ label: string; hex: string }> = [
  { label: "Teal", hex: "#2dd4bf" },
  { label: "Blue", hex: "#3b82f6" },
  { label: "Purple", hex: "#a855f7" },
  { label: "Pink", hex: "#ec4899" },
  { label: "Red", hex: "#ef4444" },
  { label: "Orange", hex: "#f97316" },
  { label: "Gold", hex: "#eab308" },
  { label: "Green", hex: "#22c55e" }
];

/** No choice: the server's colour. "none": no accent. Otherwise a `#rrggbb` colour. */
export type AccentChoice = "server" | "none" | string;

const PROFILE_KEY = "hopper-profile-accent-v1";
export const ACCENT_CHANGED_EVENT = "hopper-accent-changed";

function profileStoreKey(serverUrl: string, profileId: string) {
  return `${serverUrl}|${profileId}`;
}

function readProfileStore(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch { return {}; }
}

export function profileAccentChoice(serverUrl: string, profileId: string | undefined): AccentChoice {
  if (!profileId) return "server";
  const stored = readProfileStore()[profileStoreKey(serverUrl, profileId)];
  if (stored === "none") return "none";
  return normalizeHex(stored) ?? "server";
}

export function setProfileAccentChoice(serverUrl: string, profileId: string, choice: AccentChoice) {
  const store = readProfileStore();
  const key = profileStoreKey(serverUrl, profileId);
  const hex = normalizeHex(choice);
  if (choice === "none") store[key] = "none";
  else if (hex) store[key] = hex;
  else delete store[key];
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(store)); } catch { /* Storage blocked: the choice applies until the app closes. */ }
  window.dispatchEvent(new Event(ACCENT_CHANGED_EVENT));
}

/** The accent to show: the profile's choice on this TV, else the server's. */
export function resolveAccent(choice: AccentChoice, serverAccent: unknown): string | null {
  if (choice === "none") return null;
  return normalizeHex(choice) ?? normalizeHex(serverAccent);
}
