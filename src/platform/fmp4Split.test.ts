import { describe, expect, it } from "vitest";
import { Fmp4Splitter } from "./fmp4Split";

// A minimal fragmented MP4 as Silo's packager writes it: an init segment with a video and an
// audio track, then a moof + mdat holding both tracks' samples, offsets counted from the moof.

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
function box(type: string, ...parts: number[][]): number[] {
  const body = parts.flat();
  return [...u32(8 + body.length), ...ascii(type), ...body];
}
const full = (version: number, flags: number) => [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255];

function trak(id: number, handler: "vide" | "soun") {
  const tkhd = box("tkhd", full(0, 3), u32(0), u32(0), u32(id), u32(0), u32(0), new Array(60).fill(0));
  const hdlr = box("hdlr", full(0, 0), u32(0), ascii(handler), new Array(12).fill(0), [0]);
  return box("trak", tkhd, box("mdia", hdlr));
}
const trex = (id: number, defaultSize = 0) => box("trex", full(0, 0), u32(id), u32(1), u32(0), u32(defaultSize), u32(0));

function initSegment() {
  return [...box("ftyp", ascii("iso6"), u32(0)), ...box("moov", box("mvhd", full(0, 0), new Array(96).fill(0)), trak(1, "vide"), trak(2, "soun"), box("mvex", trex(1), trex(2)))];
}

/** One fragment: `video` and `audio` are each one sample's bytes, video first in the mdat. */
function fragment(video: number[], audio: number[]) {
  const trafFor = (id: number, size: number, offset: number) => box("traf",
    box("tfhd", full(0, 0x020000), u32(id)),
    box("trun", full(0, 0x000001 | 0x000200), u32(1), u32(offset), u32(size)));
  // Offsets depend on the moof's size, which does not depend on the offsets' values.
  const draft = box("moof", box("mfhd", full(0, 0), u32(1)), trafFor(1, video.length, 0), trafFor(2, audio.length, 0));
  const dataStart = draft.length + 8;
  const moof = box("moof", box("mfhd", full(0, 0), u32(1)), trafFor(1, video.length, dataStart), trafFor(2, audio.length, dataStart + video.length));
  return [...moof, ...box("mdat", video, audio)];
}

/** Reads the samples a split stream points at: each trun's data offset into the following mdat. */
function samplesOf(bytes: Uint8Array): number[][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) => String.fromCharCode(...bytes.subarray(at + 4, at + 8));
  const out: number[][] = [];
  let at = 0;
  let moofStart = -1;
  let pending: Array<{ offset: number; size: number }> = [];
  while (at < bytes.length) {
    const size = view.getUint32(at);
    if (type(at) === "moof") {
      moofStart = at;
      pending = [];
      const walk = (from: number, to: number) => {
        for (let p = from; p < to;) {
          const s = view.getUint32(p);
          if (type(p) === "traf") walk(p + 8, p + s);
          if (type(p) === "trun") pending.push({ offset: view.getInt32(p + 16), size: view.getUint32(p + 20) });
          p += s;
        }
      };
      walk(at + 8, at + size);
    } else if (type(at) === "mdat") {
      for (const sample of pending) out.push([...bytes.subarray(moofStart + sample.offset, moofStart + sample.offset + sample.size)]);
    }
    at += size;
  }
  return out;
}

const VIDEO = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const AUDIO = [200, 201, 202, 203];

describe("splitting muxed fMP4 for Dolby audio", () => {
  it("gives each buffer an init segment with only its own track", () => {
    const parts = new Fmp4Splitter().push(new Uint8Array(initSegment()))!;
    const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);
    expect(text(parts.video)).toContain("vide");
    expect(text(parts.video)).not.toContain("soun");
    expect(text(parts.audio)).toContain("soun");
    expect(text(parts.audio)).not.toContain("vide");
  });

  it("copies each track's samples byte for byte, with offsets that point at them", () => {
    const splitter = new Fmp4Splitter();
    splitter.push(new Uint8Array(initSegment()));
    const parts = splitter.push(new Uint8Array(fragment(VIDEO, AUDIO)))!;
    expect(samplesOf(parts.video)).toEqual([VIDEO]);
    expect(samplesOf(parts.audio)).toEqual([AUDIO]);
  });

  it("holds back a box cut in two and finishes it with the next chunk", () => {
    const splitter = new Fmp4Splitter();
    splitter.push(new Uint8Array(initSegment()));
    const bytes = new Uint8Array(fragment(VIDEO, AUDIO));
    const first = splitter.push(bytes.subarray(0, 30))!;
    expect(first.video.length + first.audio.length).toBe(0);
    const rest = splitter.push(bytes.subarray(30))!;
    expect(samplesOf(rest.video)).toEqual([VIDEO]);
    expect(samplesOf(rest.audio)).toEqual([AUDIO]);
  });

  it("refuses data it cannot split rather than guess", () => {
    const splitter = new Fmp4Splitter();
    splitter.push(new Uint8Array(initSegment()));
    expect(splitter.push(new Uint8Array(box("mdat", [1, 2, 3])))).toBeNull();
  });
});
