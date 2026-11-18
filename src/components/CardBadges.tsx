import { memo } from "react";
import { cardBadges, drawnPreset, OVERLAY_POSITIONS, type CardOverlayPrefs, type OverlayData } from "../core/cardOverlays";
import { useCardOverlays } from "../core/cardOverlayStore";
import type { SiloItem } from "../types";

/** A `#RRGGBB` accent mixed over an rgba fill (Android OverlayColor.mix): `weight` of the accent. */
function mix(accent: string, weight: number, base: [number, number, number, number]) {
  const value = Number.parseInt(accent.slice(1), 16);
  const channel = (shift: number, b: number) => Math.round(((value >> shift) & 255) * weight + b * (1 - weight));
  return `rgba(${channel(16, base[0])}, ${channel(8, base[1])}, ${channel(0, base[2])}, ${(weight + base[3] * (1 - weight)).toFixed(3)})`;
}

/** `#RRGGBBAA` as CSS. */
const rgba = (value: string) => {
  const n = Number.parseInt(value.slice(1), 16);
  return `rgba(${(n >>> 24) & 255}, ${(n >> 16) & 255}, ${(n >> 8) & 255}, ${((n & 255) / 255).toFixed(3)})`;
};

/** A badge's colours for the preset and its accent (Android OverlayPresets.basePaint), as CSS. */
function paint(preset: ReturnType<typeof drawnPreset>, accent: string | undefined) {
  switch (preset) {
    case "minimal": return { background: "transparent", color: accent ?? "rgba(255, 255, 255, .85)" };
    case "vibrant": return { background: accent ?? "rgba(220, 220, 220, .95)", color: accent ? "#fff" : "#000" };
    case "pill": return { background: accent ? mix(accent, 0.2, [20, 20, 30, 0.7]) : "rgba(20, 20, 30, .7)", color: "#fff" };
    case "square": return { background: "rgba(0, 0, 0, .8)", color: accent ?? "#fff", borderLeftColor: accent };
    default: return { background: accent ? mix(accent, 0.28, [0, 0, 0, 0.6]) : "rgba(0, 0, 0, .6)", color: "#fff" };
  }
}

/** The data a poster's badges read (Android OverlayDataExtractor). */
export function overlayDataOf(item: SiloItem): OverlayData {
  return {
    ...item.Overlay,
    ratingImdb: item.ImdbRating,
    ratingTmdb: item.TmdbRating,
    contentRating: item.ContentRating,
    year: item.ProductionYear,
    runtime: item.RuntimeMinutes
  };
}

/**
 * The badges on one poster (#175). Static spans, no transitions, so a card costs no compositor
 * layer. The top-right corner stays the watched check's.
 */
export const CardBadges = memo(function CardBadges({ item }: { item: SiloItem }) {
  const { enabled, prefs } = useCardOverlays();
  if (!enabled || !prefs) return null;
  return <BadgeLayer item={item} prefs={prefs} />;
});

function BadgeLayer({ item, prefs }: { item: SiloItem; prefs: CardOverlayPrefs }) {
  const byPosition = cardBadges(overlayDataOf(item), prefs);
  if (!OVERLAY_POSITIONS.some(position => byPosition[position]?.length)) return null;
  const preset = drawnPreset(prefs.preset);
  const style = prefs.style;
  const layerStyle: Record<string, string> = {};
  if (style?.size) layerStyle["--badge-size"] = String(style.size);
  return (
    <div className={`card-badges card-badges-${preset}${style?.shadow ? " card-badges-shadow" : ""}${style?.uppercase === false ? " card-badges-plain" : ""}${style?.shape ? ` card-badges-shape-${style.shape}` : ""}`} style={layerStyle} aria-hidden="true">
      {OVERLAY_POSITIONS.map(position => {
        const badges = byPosition[position];
        if (!badges?.length) return null;
        return (
          <div key={position} className={`card-badge-stack card-badge-${position}`}>
            {badges.map(badge => {
              const colors = paint(preset, badge.accent);
              return (
                <span key={badge.id} className="card-badge" style={{
                  background: style?.background ? rgba(style.background) : colors.background,
                  color: style?.textColor ?? colors.color,
                  borderColor: style?.borderColor ? rgba(style.borderColor) : undefined,
                  borderLeftColor: colors.borderLeftColor
                }}>{badge.text}</span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
