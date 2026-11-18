/**
 * Every intro, recap, credits and preview range of a file (#166; Android TV's MarkerTimeline, after
 * the web player's resolveMarkerRegions). The singular `intro`/`recap`/`credits`/`preview` fields
 * hold only the first occurrence of each kind; `marker_segments` holds them all. A server that
 * sends the list, even empty, is followed; an older one that omits it falls back to the fields.
 */
import type { FileMarkers } from "../api/playback";

export type MarkerKind = "intro" | "recap" | "credits" | "preview";
export type MarkerRange = { kind: MarkerKind; start: number; end: number };

const KINDS: MarkerKind[] = ["intro", "recap", "credits", "preview"];

const valid = (kind: unknown, start: unknown, end: unknown): kind is MarkerKind =>
  KINDS.includes(kind as MarkerKind) && typeof start === "number" && typeof end === "number"
  && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;

/** The ranges in start order. */
export function markerRanges(markers: FileMarkers | null | undefined): MarkerRange[] {
  if (!markers) return [];
  const ranges: MarkerRange[] = [];
  if (Array.isArray(markers.marker_segments)) {
    for (const segment of markers.marker_segments) {
      if (segment && valid(segment.kind, segment.start_seconds, segment.end_seconds)) {
        ranges.push({ kind: segment.kind, start: segment.start_seconds, end: segment.end_seconds });
      }
    }
  } else {
    for (const kind of KINDS) {
      const segment = markers[kind];
      if (segment && valid(kind, segment.start_seconds, segment.end_seconds)) ranges.push({ kind, start: segment.start_seconds, end: segment.end_seconds });
    }
  }
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end);
}

/** The range of one of these kinds the position is in; where ranges overlap, the one that started last. */
export function rangeAt(ranges: MarkerRange[], position: number, kinds: MarkerKind[]): MarkerRange | undefined {
  let found: MarkerRange | undefined;
  for (const range of ranges) {
    if (kinds.includes(range.kind) && position >= range.start && position < range.end) found = range;
  }
  return found;
}

/** A range's identity for "offered", "skipped" and "dismissed": each occurrence is its own. */
export const rangeKey = (range: MarkerRange) => `${range.kind}:${range.start}`;

/**
 * Where Up Next appears: the start of the last credits range, extended back over credits ranges
 * that run into it. Content between two separate ranges (a mid-credits scene) plays first.
 */
export function upNextStart(ranges: MarkerRange[]): number | undefined {
  const credits = ranges.filter(range => range.kind === "credits");
  if (!credits.length) return undefined;
  let start = credits[credits.length - 1].start;
  for (let index = credits.length - 2; index >= 0; index -= 1) {
    if (credits[index].end >= start - 1) start = Math.min(start, credits[index].start);
    else break;
  }
  return start;
}
