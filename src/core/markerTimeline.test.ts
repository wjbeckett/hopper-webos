import { describe, expect, it } from "vitest";
import type { FileMarkers } from "../api/playback";
import { markerRanges, rangeAt, rangeKey, upNextStart } from "./markerTimeline";

const base: FileMarkers = { file_id: "f", intro: null, credits: null, recap: null, preview: null, marker_segments: [] };
// Game of Thrones S02E03 from TheIntroDB, Android's example.
const got: FileMarkers = {
  ...base,
  recap: { start_seconds: 20, end_seconds: 107 },
  intro: { start_seconds: 108, end_seconds: 220 },
  credits: { start_seconds: 2975.5, end_seconds: 3167.4 },
  marker_segments: [
    { kind: "credits", start_seconds: 3189, end_seconds: 3300 },
    { kind: "recap", start_seconds: 20, end_seconds: 107 },
    { kind: "intro", start_seconds: 108, end_seconds: 220 },
    { kind: "credits", start_seconds: 2975.5, end_seconds: 3167.4 }
  ]
};

describe("marker timeline (#166)", () => {
  it("reads every occurrence, in order", () => {
    expect(markerRanges(got).map(rangeKey)).toEqual(["recap:20-107", "intro:108-220", "credits:2975.5-3167.4", "credits:3189-3300"]);
  });

  it("offers Skip Credits in both ranges, and nothing in the gap between them", () => {
    const ranges = markerRanges(got);
    expect(rangeAt(ranges, 3000, ["intro", "recap", "credits"])?.end).toBe(3167.4);
    expect(rangeAt(ranges, 3175, ["intro", "recap", "credits"])).toBeUndefined();
    expect(rangeAt(ranges, 3200, ["intro", "recap", "credits"])?.end).toBe(3300);
  });

  it("starts Up Next at the last credits range, after the mid-credits scene", () => {
    expect(upNextStart(markerRanges(got))).toBe(3189);
  });

  it("extends Up Next back over credits ranges that run into the last", () => {
    const joined: FileMarkers = { ...base, marker_segments: [
      { kind: "credits", start_seconds: 100, end_seconds: 200 },
      { kind: "credits", start_seconds: 200.5, end_seconds: 300 }
    ] };
    expect(upNextStart(markerRanges(joined))).toBe(100);
  });

  it("falls back to the single fields when the server sends no list", () => {
    const older = { ...base, marker_segments: undefined, credits: { start_seconds: 50, end_seconds: 60 } } as unknown as FileMarkers;
    expect(markerRanges(older)).toEqual([{ kind: "credits", start: 50, end: 60 }]);
    expect(upNextStart(markerRanges(older))).toBe(50);
  });

  it("follows an empty list: no markers", () => {
    expect(markerRanges({ ...base, credits: { start_seconds: 50, end_seconds: 60 } })).toEqual([]);
  });

  it("drops invalid ranges and unknown kinds", () => {
    const odd: FileMarkers = { ...base, marker_segments: [
      { kind: "intro", start_seconds: 30, end_seconds: 10 },
      { kind: "commercial", start_seconds: 1, end_seconds: 2 },
      { kind: "intro", start_seconds: Number.NaN, end_seconds: 2 },
      { kind: "recap", start_seconds: 0, end_seconds: 5 }
    ] };
    expect(markerRanges(odd)).toEqual([{ kind: "recap", start: 0, end: 5 }]);
  });

  it("keeps two ranges that start together apart", () => {
    const ranges = markerRanges({ ...base, marker_segments: [
      { kind: "recap", start_seconds: 10, end_seconds: 20 },
      { kind: "recap", start_seconds: 10, end_seconds: 30 }
    ] });
    expect(new Set(ranges.map(rangeKey)).size).toBe(2);
  });

  it("joins credits ranges through one that reaches past a shorter one", () => {
    const nested: FileMarkers = { ...base, marker_segments: [
      { kind: "credits", start_seconds: 100, end_seconds: 300 },
      { kind: "credits", start_seconds: 150, end_seconds: 170 },
      { kind: "credits", start_seconds: 250, end_seconds: 320 }
    ] };
    expect(upNextStart(markerRanges(nested))).toBe(100);
  });
});
