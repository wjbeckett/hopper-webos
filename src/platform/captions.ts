import type { SubtitleAppearance } from "../api/settings";
import { lunaCall } from "./luna";

const KEYS = ["captionSize", "captionTextColor", "captionTextOpacity", "captionBgColor", "captionBgOpacity", "captionEdgeType"];
const COLORS: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ef4444", green: "#22c55e", blue: "#3b82f6", cyan: "#06b6d4", magenta: "#d946ef", yellow: "#facc15" };
const OPACITY: Record<string, number> = { solid: 100, translucent: 60, transparent: 0, flash: 100 };
const SIZES: Record<string, SubtitleAppearance["fontSize"]> = { small: "small", standard: "large", large: "xlarge" };

async function readDeviceCaptions(): Promise<Record<string, string> | null> {
  const reply = await lunaCall("luna://com.webos.settingsservice/getSystemSettings", { category: "caption", keys: KEYS });
  if (!reply || reply.returnValue === false) return null;
  const settings = reply.settings;
  return settings && typeof settings === "object" ? settings as Record<string, string> : null;
}

export async function deviceCaptioningAppearance(base: SubtitleAppearance): Promise<SubtitleAppearance> {
  const caption = await readDeviceCaptions();
  if (!caption) return base;
  const bgOpacity = OPACITY[caption.captionBgOpacity] ?? base.backgroundOpacity;
  return {
    ...base,
    fontSize: SIZES[caption.captionSize] ?? base.fontSize,
    fontColor: COLORS[caption.captionTextColor] ?? base.fontColor,
    textOpacity: OPACITY[caption.captionTextOpacity] ?? base.textOpacity,
    backgroundColor: COLORS[caption.captionBgColor] ?? base.backgroundColor,
    backgroundOpacity: bgOpacity,
    backgroundStyle: bgOpacity === 0 ? "none" : "box",
    textOutline: Boolean(caption.captionEdgeType) && caption.captionEdgeType !== "none",
  };
}

const flagKey = (profileId: string | undefined) => `silo.subtitleMatchesDevice.${profileId ?? ""}`;

export function getSubtitleMatchesDevice(profileId: string | undefined) {
  try { return localStorage.getItem(flagKey(profileId)) === "1"; } catch { return false; }
}

export function setSubtitleMatchesDevice(profileId: string | undefined, enabled: boolean) {
  try { localStorage.setItem(flagKey(profileId), enabled ? "1" : "0"); } catch { /* storage unavailable */ }
}
