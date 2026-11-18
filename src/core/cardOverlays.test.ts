import { describe, expect, it } from "vitest";
import { cardBadges, defaultPrefs, drawnPreset, formatOutOfTen, parseOverlayPrefs, resolveOverlayPrefs } from "./cardOverlays";

// A card from the live server: "Guarding Stars".
const dv = { resolution: "2160p", hdr: "DV HDR10", audio: "Atmos", audioChannels: "5.1", videoCodec: "H.265", container: "MKV", aspectRatio: "16:9", multiSub: true, year: 2024, runtime: 125, ratingImdb: 7.35 };

describe("poster badges (#175)", () => {
  it("draws the default badges: resolution, HDR and audio top left", () => {
    expect(cardBadges(dv, defaultPrefs())).toEqual({
      "top-left": [{ id: "resolution", text: "4K" }, { id: "hdr", text: "DV HDR10" }, { id: "audio", text: "Atmos" }]
    });
  });

  it("lets a combined badge stand in for the ones it covers", () => {
    const prefs = parseOverlayPrefs({ version: 2, preset: "classic", items: { resolution_hdr_audio: { enabled: true, position: "top-left" } } });
    expect(cardBadges(dv, prefs)["top-left"]).toEqual([{ id: "resolution_hdr_audio", text: "4K DV Atmos" }]);
  });

  it("follows the document's positions, order and accents", () => {
    const prefs = parseOverlayPrefs({
      version: 2, preset: "vibrant", order: ["year", "runtime"],
      items: {
        resolution: { enabled: false }, hdr: { enabled: false }, audio: { enabled: false },
        runtime: { enabled: true, position: "bottom-left" }, year: { enabled: true, position: "bottom-left", accentColor: "#112233" },
        rating_imdb: { enabled: true, position: "top-right" }
      }
    });
    const badges = cardBadges(dv, prefs);
    expect(badges["bottom-left"]).toEqual([{ id: "year", text: "2024", accent: "#112233" }, { id: "runtime", text: "2h 5m" }]);
    // The top-right corner is the watched check's: a stored badge there moves to the right edge.
    expect(badges["right-edge"]).toEqual([{ id: "rating_imdb", text: "IMDb 7.4", accent: "#f5c518" }]);
    expect(drawnPreset(prefs.preset)).toBe("vibrant");
  });

  it("caps a corner at three badges", () => {
    const prefs = parseOverlayPrefs({ version: 2, preset: "classic", items: { audio_channels: { enabled: true }, video_codec: { enabled: true } } });
    expect(cardBadges(dv, prefs)["top-left"]).toHaveLength(3);
  });

  it("reads the profile's own document before the server's defaults", () => {
    const server = JSON.stringify({ version: 2, preset: "square", items: {} });
    expect(resolveOverlayPrefs(undefined, server).preset).toBe("square");
    expect(resolveOverlayPrefs({ version: 2, preset: "minimal", items: {} }, server).preset).toBe("minimal");
    expect(resolveOverlayPrefs(undefined, undefined)).toEqual(defaultPrefs());
  });

  it("reads a v1 document and survives a bad one", () => {
    expect(parseOverlayPrefs({ audio: { enabled: false, position: "bottom-left" } }).items.audio).toEqual({ enabled: false, position: "bottom-left", accentColor: undefined });
    expect(parseOverlayPrefs("not json")).toEqual(defaultPrefs());
    expect(parseOverlayPrefs({ version: 2, preset: "neon", items: { resolution: { position: "middle" } } }).items.resolution.position).toBe("top-left");
  });

  it("draws Plate and Edge band as Classic for now", () => {
    expect(drawnPreset("plate")).toBe("classic");
    expect(drawnPreset("band")).toBe("classic");
  });

  it("rounds ratings as the web does", () => {
    expect(formatOutOfTen(7.35)).toBe("7.4");
    expect(formatOutOfTen(8)).toBe("8.0");
  });
});
