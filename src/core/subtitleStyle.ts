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

export function subtitleCueCss(appearance: SubtitleAppearance) {
  const outline = appearance.textOutline ? `-1px -1px 0 ${appearance.textOutlineColor},1px -1px 0 ${appearance.textOutlineColor},-1px 1px 0 ${appearance.textOutlineColor},1px 1px 0 ${appearance.textOutlineColor}` : "";
  const shadow = appearance.backgroundStyle === "shadow" ? "0 2px 6px rgba(0,0,0,.95)" : appearance.backgroundStyle === "outline" ? "-2px 0 #000,2px 0 #000,0 -2px #000,0 2px #000" : "";
  const textShadow = [outline, shadow].filter(Boolean).join(",") || "none";
  const background = appearance.backgroundStyle === "box" ? rgba(appearance.backgroundColor, appearance.backgroundOpacity) : "transparent";
  return `video.player::-webkit-media-text-track-container { align-items: ${appearance.position === "top" ? "flex-start" : "flex-end"}; padding-bottom: 0; padding-top: 0; top: ${appearance.position === "top" ? "0" : "auto"}; bottom: ${appearance.position === "top" ? "auto" : "auto"}; height: 92%; margin-top: ${appearance.position === "top" ? "0" : "auto"}; translate: 0 ${appearance.position === "bottom" ? "0" : appearance.position === "lower-third" ? "-15vh" : "-80vh"}; }
  video.player::cue { background-color: transparent; }
  video.player::cue { color: ${rgba(appearance.fontColor, appearance.textOpacity)}; font-family: ${appearance.fontFamily}; font-size: ${SIZE_VH[appearance.fontSize] ?? 5}vh; background-color: ${background}; text-shadow: ${textShadow}; }`;
}

export type AppearanceChoice = { label: string; value: string | number | boolean; detail?: string };

export const SUBTITLE_APPEARANCE_FIELDS: Array<[keyof SubtitleAppearance, string]> = [["fontSize", "Font size"], ["fontFamily", "Font family"], ["fontColor", "Font color"], ["textOpacity", "Text opacity"], ["backgroundStyle", "Background style"], ["backgroundColor", "Background color"], ["backgroundOpacity", "Background opacity"], ["textOutline", "Text outline"], ["textOutlineColor", "Outline color"], ["position", "Position"]];

const FONT_COLORS: AppearanceChoice[] = [["#ffffff", "White"], ["#facc15", "Yellow"], ["#22c55e", "Green"], ["#06b6d4", "Cyan"], ["#d946ef", "Magenta"], ["#ef4444", "Red"], ["#3b82f6", "Blue"], ["#9ca3af", "Gray"], ["#000000", "Black"]].map(([value, label]) => ({ label, value }));
const BACKGROUND_COLORS: AppearanceChoice[] = [["#000000", "Black"], ["#374151", "Dark Gray"], ["#1e3a5f", "Navy"], ["#7f1d1d", "Dark Red"], ["#14532d", "Dark Green"]].map(([value, label]) => ({ label, value }));

export const SUBTITLE_APPEARANCE_CHOICES: Record<keyof SubtitleAppearance, AppearanceChoice[]> = {
  fontSize: [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["xlarge", "X-Large"], ["xxlarge", "XX-Large"]].map(([value, label]) => ({ label, value })),
  fontFamily: [["sans-serif", "Sans-serif"], ["serif", "Serif"], ["monospace", "Monospace"]].map(([value, label]) => ({ label, value })),
  fontColor: FONT_COLORS,
  textOpacity: [25, 50, 75, 100].map(value => ({ label: `${value}%`, value })),
  backgroundColor: BACKGROUND_COLORS,
  backgroundStyle: [["none", "No background"], ["box", "Box"], ["shadow", "Drop Shadow"], ["outline", "Outline"]].map(([value, label]) => ({ label, value })),
  backgroundOpacity: [0, 25, 50, 75, 100].map(value => ({ label: `${value}%`, value })),
  textOutline: [{ label: "On", value: true }, { label: "Off", value: false }],
  textOutlineColor: BACKGROUND_COLORS,
  position: [{ label: "Bottom", value: "bottom" }, { label: "Lower Third", value: "lower-third" }, { label: "Top", value: "top" }]
};

function percentChoices(from: number, current: unknown): AppearanceChoice[] {
  const steps = new Set<number>();
  for (let value = from; value <= 100; value += 5) steps.add(value);
  if (typeof current === "number") steps.add(current);
  return Array.from(steps).sort((a, b) => a - b).map(value => ({ label: `${value}%`, value }));
}

export function settingsAppearanceChoices(key: keyof SubtitleAppearance, current: unknown): AppearanceChoice[] {
  if (key === "textOpacity") return percentChoices(5, current);
  if (key === "backgroundOpacity") return percentChoices(0, current);
  return SUBTITLE_APPEARANCE_CHOICES[key];
}

export function subtitleChoiceLabel(key: keyof SubtitleAppearance, value: unknown) {
  if (key === "textOpacity" || key === "backgroundOpacity") return `${value}%`;
  return SUBTITLE_APPEARANCE_CHOICES[key].find(choice => typeof value === "string" ? String(choice.value).toLowerCase() === value.toLowerCase() : choice.value === value)?.label ?? String(value);
}
