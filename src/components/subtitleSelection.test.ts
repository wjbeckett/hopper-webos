import { describe, expect, it } from "vitest";
import { combinedSubtitleIndexes } from "./PlaybackOptions";

describe("title-page subtitle selection (#167)", () => {
  it("numbers externals first, then embedded tracks, as /playback/start does", () => {
    // /watch can list an embedded track before an external one.
    const tracks = [
      { index: 0, codec: "", language: "eng" },
      { index: 1, codec: "srt", language: "eng", external: true }
    ];
    expect(combinedSubtitleIndexes(tracks)).toEqual([1, 0]);
  });

  it("ignores the catalog's own index", () => {
    const tracks = [{ index: 7, codec: "subrip" }, { index: 3, codec: "ass" }];
    expect(combinedSubtitleIndexes(tracks)).toEqual([0, 1]);
  });
});
