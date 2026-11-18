/**
 * Badges on poster cards (#175): resolution, HDR, audio, ratings and so on, from the server's
 * card-overlay settings. A port of the shared overlay model the web, Android TV and tvOS use
 * (silo-android `shared/.../overlays`: OverlayRegistry, OverlaySchema, OverlayPresets), trimmed
 * to what Hopper draws: badges as text, in the five positions, in the Classic, Minimal, Vibrant,
 * Pill and Square looks (Plate and Edge band draw as Classic), with the style's colours and shape.
 * Uploaded badge images, icons and ribbons are not drawn yet.
 *
 * The document is the profile's `ui.card_overlays` when the profile set one, else the server's
 * `defaults` (`GET /settings/overlay-config`), else the registry's defaults, as on Android TV.
 */

export type OverlayPosition = "top-left" | "bottom-left" | "bottom-right" | "left-edge" | "right-edge";
export const OVERLAY_POSITIONS: OverlayPosition[] = ["top-left", "bottom-left", "bottom-right", "left-edge", "right-edge"];
export type PresetId = "minimal" | "classic" | "vibrant" | "pill" | "square" | "plate" | "band";
const PRESETS: PresetId[] = ["minimal", "classic", "vibrant", "pill", "square", "plate", "band"];

/** What a card knows for its badges (Android OverlayData). */
export type OverlayData = {
  resolution?: string; hdr?: string; audio?: string; audioChannels?: string; videoCodec?: string;
  container?: string; aspectRatio?: string; releaseType?: string; edition?: string;
  multiAudio?: boolean; multiSub?: boolean;
  ratingImdb?: number; ratingTmdb?: number; ratingRtCritic?: number; ratingRtAudience?: number;
  contentRating?: string; year?: number; runtime?: number; originalLanguage?: string; studio?: string; network?: string;
};

type OverlayDef = {
  id: string;
  position: OverlayPosition;
  enabled: boolean;
  accent?: string;
  value: (data: OverlayData) => string | undefined;
};

/** Web `prettyResolution`. */
function prettyResolution(value?: string) {
  const v = value?.trim().toLowerCase();
  if (!v) return undefined;
  if (["2160p", "4k", "uhd"].includes(v)) return "4K";
  if (["4320p", "8k"].includes(v)) return "8K";
  return /^\d+p$/.test(v) ? v : value!.toUpperCase();
}

/** Web `compactHdrSuffix`: any Dolby Vision is "DV", HDR10+ keeps its name, other HDR is "HDR". */
function compactHdr(value?: string) {
  if (!value) return undefined;
  if (value.includes("DV")) return "DV";
  if (value.includes("HDR10+")) return "HDR10+";
  return "HDR";
}

/** Web `formatOutOfTen`: one decimal, halves away from zero. */
export const formatOutOfTen = (value: number) => (Math.floor(value * 10 + 0.5) / 10).toFixed(1);
const percent = (value: number) => `${Math.floor(value + 0.5)}%`;
const text = (value?: string) => (value && value.trim() ? value.trim() : undefined);
const joined = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" ") || undefined;
const rating = (mark: string, score?: string) => (score ? `${mark} ${score}` : undefined);

/** The registry, in Android's order: the default render order within each position. */
export const OVERLAY_REGISTRY: OverlayDef[] = [
  { id: "resolution", position: "top-left", enabled: true, value: d => prettyResolution(d.resolution) },
  { id: "hdr", position: "top-left", enabled: true, value: d => text(d.hdr) },
  { id: "resolution_hdr", position: "top-left", enabled: false, value: d => { const res = prettyResolution(d.resolution); return res ? joined(res, compactHdr(d.hdr)) : undefined; } },
  { id: "resolution_hdr_audio", position: "top-left", enabled: false, value: d => joined(prettyResolution(d.resolution), compactHdr(d.hdr), text(d.audio)) },
  { id: "audio", position: "top-left", enabled: true, value: d => text(d.audio) },
  { id: "audio_channels", position: "top-left", enabled: false, value: d => text(d.audioChannels) },
  { id: "video_codec", position: "top-left", enabled: false, value: d => text(d.videoCodec) },
  { id: "container", position: "bottom-left", enabled: false, value: d => text(d.container) },
  { id: "aspect_ratio", position: "bottom-right", enabled: false, value: d => text(d.aspectRatio) },
  { id: "release_type", position: "bottom-left", enabled: true, value: d => text(d.releaseType) },
  { id: "edition", position: "bottom-left", enabled: false, value: d => text(d.edition) },
  { id: "multi_audio", position: "bottom-right", enabled: false, value: d => (d.multiAudio ? "Multi-Audio" : undefined) },
  { id: "multi_sub", position: "bottom-right", enabled: false, value: d => (d.multiSub ? "Subtitles" : undefined) },
  { id: "rating_imdb", position: "left-edge", enabled: false, accent: "#f5c518", value: d => rating("IMDb", d.ratingImdb != null ? formatOutOfTen(d.ratingImdb) : undefined) },
  { id: "rating_tmdb", position: "left-edge", enabled: false, accent: "#01b4e4", value: d => rating("TMDB", d.ratingTmdb != null ? formatOutOfTen(d.ratingTmdb) : undefined) },
  { id: "rating_rt", position: "left-edge", enabled: false, accent: "#fa320a", value: d => rating("RT", d.ratingRtCritic != null ? percent(d.ratingRtCritic) : undefined) },
  { id: "rating_rt_audience", position: "left-edge", enabled: false, accent: "#fa6400", value: d => rating("RT Audience", d.ratingRtAudience != null ? percent(d.ratingRtAudience) : undefined) },
  { id: "content_rating", position: "bottom-right", enabled: false, value: d => text(d.contentRating) },
  { id: "year", position: "bottom-left", enabled: false, value: d => (d.year && d.year > 0 ? String(d.year) : undefined) },
  { id: "runtime", position: "bottom-left", enabled: false, value: d => {
    if (!d.runtime || d.runtime <= 0) return undefined;
    const h = Math.floor(d.runtime / 60);
    const m = d.runtime % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  } },
  { id: "original_language", position: "bottom-left", enabled: false, value: d => text(d.originalLanguage)?.toUpperCase() },
  { id: "studio", position: "bottom-right", enabled: false, value: d => text(d.studio) },
  { id: "network", position: "bottom-right", enabled: false, value: d => text(d.network) }
];

/** A combined badge hides the ones whose information it already shows (web `COMBINED_BADGES`). */
const COMBINED: Record<string, string[]> = {
  resolution_hdr_audio: ["resolution", "hdr", "audio", "resolution_hdr"],
  resolution_hdr: ["resolution", "hdr"]
};

/** At most this many badges in a corner, and on an edge rail (Android MAX_BADGES_PER_*). */
export const MAX_PER_CORNER = 3;
export const MAX_PER_RAIL = 4;

export type OverlayItem = { enabled: boolean; position: OverlayPosition; accentColor?: string };
export type OverlayStyle = {
  size?: number; shape?: "pill" | "rounded" | "square"; background?: string; textColor?: string;
  borderColor?: string; uppercase?: boolean; shadow?: boolean;
};
export type CardOverlayPrefs = { preset: PresetId; order: string[]; items: Record<string, OverlayItem>; style?: OverlayStyle };

const isPosition = (value: unknown): value is OverlayPosition => OVERLAY_POSITIONS.includes(value as OverlayPosition);
/** A stored `top-right` moves to the right edge: that corner is the watch status's. */
const storedPosition = (value: unknown) => (value === "top-right" ? "right-edge" : isPosition(value) ? value : undefined);
const hex = (value: unknown, alpha = false) =>
  typeof value === "string" && (alpha ? /^#[0-9a-fA-F]{8}$/ : /^#[0-9a-fA-F]{6}$/).test(value) ? value : undefined;

export function defaultPrefs(): CardOverlayPrefs {
  return { preset: "classic", order: [], items: Object.fromEntries(OVERLAY_REGISTRY.map(def => [def.id, { enabled: def.enabled, position: def.position }])) };
}

function rootObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try { return rootObject(JSON.parse(raw)); } catch { return null; }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

/**
 * A stored document (an object, or the legacy JSON-string encoding) as prefs (Android
 * OverlaySchema.parse): a field that isn't valid falls back to the default on its own; v1
 * documents (a flat id → config map) are read as items. Anything else is the defaults.
 */
export function parseOverlayPrefs(raw: unknown): CardOverlayPrefs {
  const doc = rootObject(raw);
  const base = defaultPrefs();
  if (!doc) return base;
  const v2 = doc.version === 2 || (typeof doc.preset === "string" && typeof doc.items === "object" && doc.items !== null);
  const source = (v2 ? rootObject(doc.items) : doc) ?? {};
  const items: Record<string, OverlayItem> = {};
  for (const def of OVERLAY_REGISTRY) {
    const patch = rootObject(source[def.id]);
    items[def.id] = {
      enabled: typeof patch?.enabled === "boolean" ? patch.enabled : def.enabled,
      position: storedPosition(patch?.position) ?? def.position,
      accentColor: hex(patch?.accentColor)
    };
  }
  if (!v2) return { ...base, items };
  const style = rootObject(doc.style);
  const shape = style?.shape;
  const parsedStyle: OverlayStyle | undefined = style ? {
    size: typeof style.size === "number" && style.size >= 0.75 && style.size <= 2 ? style.size : undefined,
    shape: shape === "pill" || shape === "rounded" || shape === "square" ? shape : undefined,
    background: hex(style.background, true),
    textColor: hex(style.textColor),
    borderColor: hex(style.borderColor, true),
    uppercase: typeof style.uppercase === "boolean" ? style.uppercase : undefined,
    shadow: typeof style.shadow === "boolean" ? style.shadow : undefined
  } : undefined;
  return {
    preset: PRESETS.includes(doc.preset as PresetId) ? doc.preset as PresetId : "classic",
    order: Array.isArray(doc.order) ? doc.order.filter((id): id is string => typeof id === "string") : [],
    items,
    style: parsedStyle && Object.values(parsedStyle).some(value => value !== undefined) ? parsedStyle : undefined
  };
}

/** The document cards draw: the profile's own when it set one, else the server's defaults. */
export function resolveOverlayPrefs(profileValue: unknown, serverDefaults: unknown): CardOverlayPrefs {
  return profileValue != null ? parseOverlayPrefs(profileValue) : parseOverlayPrefs(serverDefaults);
}

export type Badge = { id: string; text: string; accent?: string };

/**
 * The badges a card shows, by position: enabled, not hidden by a combined badge, with a value for
 * this card, in the document's order (registry order for the rest), at most three to a corner
 * and four to an edge.
 */
export function cardBadges(data: OverlayData, prefs: CardOverlayPrefs): Partial<Record<OverlayPosition, Badge[]>> {
  const suppressed = new Set(Object.entries(COMBINED).filter(([combined]) => prefs.items[combined]?.enabled).flatMap(([, covers]) => covers));
  const rank = new Map<string, number>();
  prefs.order.forEach((id, index) => { if (!rank.has(id)) rank.set(id, index); });
  const ordered = OVERLAY_REGISTRY
    .map((def, index) => ({ def, index }))
    .sort((a, b) => (rank.get(a.def.id) ?? Infinity) - (rank.get(b.def.id) ?? Infinity) || a.index - b.index);
  const out: Partial<Record<OverlayPosition, Badge[]>> = {};
  for (const { def } of ordered) {
    const item = prefs.items[def.id];
    if (!item?.enabled || suppressed.has(def.id)) continue;
    const value = def.value(data);
    if (!value) continue;
    const list = out[item.position] ?? (out[item.position] = []);
    const cap = item.position.endsWith("-edge") ? MAX_PER_RAIL : MAX_PER_CORNER;
    if (list.length < cap) list.push({ id: def.id, text: value, accent: item.accentColor ?? def.accent });
  }
  return out;
}

/** The look Hopper draws for a preset: Plate and Edge band aren't built yet and draw as Classic. */
export function drawnPreset(preset: PresetId): "minimal" | "classic" | "vibrant" | "pill" | "square" {
  return preset === "minimal" || preset === "vibrant" || preset === "pill" || preset === "square" ? preset : "classic";
}
