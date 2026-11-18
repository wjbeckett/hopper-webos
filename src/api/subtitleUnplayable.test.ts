import { describe, expect, it } from "vitest";
import { catalogSubtitleUnplayable, subtitleUnplayable } from "./playback";

describe("subtitles the server can't show (#167)", () => {
  it("follows the server's flag", () => {
    expect(subtitleUnplayable({ unplayable: true, source: "external", codec: "srt" })).toBe(true);
    expect(subtitleUnplayable({ unplayable: false, source: "embedded", codec: "subrip" })).toBe(false);
  });

  it("treats an embedded track with no codec as unplayable on a server without the flag", () => {
    expect(subtitleUnplayable({ source: "embedded" })).toBe(true);
    expect(subtitleUnplayable({ source: " Embedded ", codec: " " })).toBe(true);
  });

  it("leaves downloaded, generated and external tracks alone when they have no codec", () => {
    expect(subtitleUnplayable({ source: "downloaded" })).toBe(false);
    expect(subtitleUnplayable({ source: "generated" })).toBe(false);
    expect(subtitleUnplayable({ source: "external" })).toBe(false);
  });

  it("applies the same rule to a title page's catalog track", () => {
    expect(catalogSubtitleUnplayable({ index: 2, language: "eng" })).toBe(true);
    expect(catalogSubtitleUnplayable({ index: 2, language: "eng", external: true })).toBe(false);
    expect(catalogSubtitleUnplayable({ index: 2, codec: "webvtt" })).toBe(false);
  });
});
