import { DEFAULT_SUBTITLE_APPEARANCE, type SubtitleAppearance } from "../api/settings";

const SIZE_VH: Record<SubtitleAppearance["fontSize"], number> = { small: 3.2, medium: 4, large: 5, xlarge: 6.4, xxlarge: 8 };

export function parseSubtitleAppearance(value: unknown): SubtitleAppearance {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  return raw && typeof raw === "object" ? { ...DEFAULT_SUBTITLE_APPEARANCE, ...(raw as Partial<SubtitleAppearance>) } : DEFAULT_SUBTITLE_APPEARANCE;
}

function rgba(hex: string, opacity: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return `rgba(0,0,0,${opacity / 100})`;
  const n = parseInt(match[1], 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.min(100, Math.max(0, opacity)) / 100})`;
}

const POSITION_BOTTOM: Record<SubtitleAppearance["position"], string> = { bottom: "5%", "lower-third": "20%", top: "78%" };

export function subtitleCueCss(appearance: SubtitleAppearance) {
  const outline = appearance.textOutline ? `-1px -1px 0 ${appearance.textOutlineColor},1px -1px 0 ${appearance.textOutlineColor},-1px 1px 0 ${appearance.textOutlineColor},1px 1px 0 ${appearance.textOutlineColor}` : "";
  const shadow = appearance.backgroundStyle === "shadow" ? "0 2px 6px rgba(0,0,0,.95)" : appearance.backgroundStyle === "outline" ? "-2px 0 #000,2px 0 #000,0 -2px #000,0 2px #000" : "";
  const textShadow = [outline, shadow].filter(Boolean).join(",") || "none";
  const background = appearance.backgroundStyle === "box" ? rgba(appearance.backgroundColor, appearance.backgroundOpacity) : "transparent";
  return `video.player::-webkit-media-text-track-container { align-items: ${appearance.position === "top" ? "flex-start" : "flex-end"}; padding-bottom: 0; padding-top: 0; top: ${appearance.position === "top" ? "0" : "auto"}; bottom: ${appearance.position === "top" ? "auto" : "auto"}; height: 92%; margin-top: ${appearance.position === "top" ? "0" : "auto"}; translate: 0 ${appearance.position === "bottom" ? "0" : appearance.position === "lower-third" ? "-15vh" : "-80vh"}; }
  video.player::cue { background-color: transparent; }
  video.player::cue { color: ${rgba(appearance.fontColor, appearance.textOpacity)}; font-family: ${appearance.fontFamily}; font-size: ${SIZE_VH[appearance.fontSize] ?? 5}vh; background-color: ${background}; text-shadow: ${textShadow}; }`;
}
