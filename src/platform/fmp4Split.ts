/**
 * Splits fragmented MP4 that carries video and audio together into one stream per track.
 *
 * Silo's HLS segments are "muxed": each one holds the video and the audio. webOS 22
 * (Chrome 87) will not take Dolby audio (AC-3, E-AC-3) in a MediaSource buffer shared with
 * video, but it takes the same audio in a buffer of its own. So the segments are taken apart
 * here and each track goes to its own buffer (see splitSourceBuffer.ts). Nothing is decoded
 * or re-encoded: the samples are copied byte for byte, so Dolby audio reaches the TV intact.
 *
 * Handles what Silo's packager (ffmpeg) writes: an init segment with one `trak` per track,
 * and media segments of `moof` + `mdat` pairs where every track fragment gives its data
 * offset from the start of the `moof`. Anything else makes it return null, and the caller
 * reports an error rather than feed the TV a guess.
 */

type Box = { type: string; start: number; size: number; header: number };

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The boxes directly inside [from, to). Null if one runs past the end (truncated data). */
function children(bytes: Uint8Array, from: number, to: number): Box[] | null {
  const data = view(bytes);
  const boxes: Box[] = [];
  let at = from;
  while (at < to) {
    if (at + 8 > to) return null;
    let size = data.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return null;
      // Sizes past 4 GB do not occur in a segment; the high word is ignored.
      size = data.getUint32(at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return null;
    boxes.push({ type: String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]), start: at, size, header });
    at += size;
  }
  return boxes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A box of `type` wrapping `payload`. */
function box(type: string, payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  const out = new Uint8Array(8 + body.length);
  view(out).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

const slice = (bytes: Uint8Array, item: Box) => bytes.subarray(item.start, item.start + item.size);

export type TrackKind = "video" | "audio";

export class Fmp4Splitter {
  /** Track id to kind, learned from the init segment. */
  private kinds = new Map<number, TrackKind>();
  /** Default sample size per track from `trex`, for fragments that do not list sizes. */
  private defaultSizes = new Map<number, number>();
  /** Bytes of a box that has not fully arrived yet. */
  private pending: Uint8Array | null = null;
  /** A `moof` waiting for its `mdat`. */
  private moof: Uint8Array | null = null;

  /**
   * Takes the next piece of the muxed stream and returns the bytes to append for each
   * track (either may be empty). Returns null when the data is not in a shape it handles.
   */
  push(chunk: Uint8Array): Record<TrackKind, Uint8Array> | null {
    const bytes = this.pending ? concat([this.pending, chunk]) : chunk;
    this.pending = null;
    const out: Record<TrackKind, Uint8Array[]> = { video: [], audio: [] };
    const data = view(bytes);
    let at = 0;
    while (at < bytes.length) {
      // Keep an incomplete trailing box for the next call.
      if (at + 8 > bytes.length) break;
      const size = data.getUint32(at);
      if (size < 8) return null;
      if (at + size > bytes.length) break;
      const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
      const whole = bytes.subarray(at, at + size);
      if (type === "ftyp" || type === "styp") {
        out.video.push(whole);
        out.audio.push(whole);
      } else if (type === "moov") {
        const split = this.splitMoov(whole);
        if (!split) return null;
        out.video.push(split.video);
        out.audio.push(split.audio);
      } else if (type === "moof") {
        this.moof = whole;
      } else if (type === "mdat") {
        if (!this.moof) return null;
        const split = this.splitFragment(this.moof, whole);
        this.moof = null;
        if (!split) return null;
        out.video.push(split.video);
        out.audio.push(split.audio);
      }
      // sidx, free and the like describe the muxed layout and are dropped.
      at += size;
    }
    if (at < bytes.length) this.pending = bytes.slice(at);
    return { video: concat(out.video), audio: concat(out.audio) };
  }

  /** One `moov` per track: its `trak`, its `trex`, and everything that is not per track. */
  private splitMoov(moov: Uint8Array): Record<TrackKind, Uint8Array> | null {
    const top = children(moov, 8, moov.length);
    if (!top) return null;
    const traks = new Map<number, Box>();
    for (const item of top.filter(entry => entry.type === "trak")) {
      const inner = children(moov, item.start + item.header, item.start + item.size);
      const tkhd = inner?.find(entry => entry.type === "tkhd");
      const mdia = inner?.find(entry => entry.type === "mdia");
      if (!inner || !tkhd || !mdia) return null;
      const version = moov[tkhd.start + 8];
      const id = view(moov).getUint32(tkhd.start + (version === 1 ? 28 : 20));
      const hdlr = children(moov, mdia.start + mdia.header, mdia.start + mdia.size)?.find(entry => entry.type === "hdlr");
      if (!hdlr) return null;
      const handler = String.fromCharCode(moov[hdlr.start + 16], moov[hdlr.start + 17], moov[hdlr.start + 18], moov[hdlr.start + 19]);
      if (handler === "vide") this.kinds.set(id, "video");
      else if (handler === "soun") this.kinds.set(id, "audio");
      traks.set(id, item);
    }
    const mvex = top.find(entry => entry.type === "mvex");
    const mvexChildren = mvex ? children(moov, mvex.start + mvex.header, mvex.start + mvex.size) : [];
    if (!mvexChildren) return null;
    for (const trex of mvexChildren.filter(entry => entry.type === "trex")) {
      this.defaultSizes.set(view(moov).getUint32(trex.start + 12), view(moov).getUint32(trex.start + 24));
    }
    const build = (kind: TrackKind): Uint8Array | null => {
      const id = [...this.kinds].find(([, value]) => value === kind)?.[0];
      const trak = id == null ? undefined : traks.get(id);
      if (id == null || !trak) return null;
      const parts: Uint8Array[] = [];
      for (const item of top) {
        if (item.type === "trak") {
          if (item === trak) parts.push(slice(moov, item));
        } else if (item.type === "mvex") {
          parts.push(box("mvex", mvexChildren
            .filter(entry => entry.type !== "trex" || view(moov).getUint32(entry.start + 12) === id)
            .map(entry => slice(moov, entry))));
        } else {
          parts.push(slice(moov, item));
        }
      }
      return box("moov", parts);
    };
    const video = build("video");
    const audio = build("audio");
    return video && audio ? { video, audio } : null;
  }

  /** One `moof` + `mdat` per track, holding only that track's samples. */
  private splitFragment(moof: Uint8Array, mdat: Uint8Array): Record<TrackKind, Uint8Array> | null {
    const top = children(moof, 8, moof.length);
    const mfhd = top?.find(entry => entry.type === "mfhd");
    if (!top || !mfhd) return null;
    const out: Record<TrackKind, Uint8Array[]> = { video: [], audio: [] };
    for (const traf of top.filter(entry => entry.type === "traf")) {
      const inner = children(moof, traf.start + traf.header, traf.start + traf.size);
      const tfhd = inner?.find(entry => entry.type === "tfhd");
      if (!inner || !tfhd) return null;
      const data = view(moof);
      const tfhdFlags = data.getUint32(tfhd.start + 8) & 0xffffff;
      const id = data.getUint32(tfhd.start + 12);
      const kind = this.kinds.get(id);
      // A track that is neither video nor audio (none are expected) is left out.
      if (!kind) continue;
      // Offsets must be counted from the start of the moof, with no explicit base. Encrypted
      // fragments carry more offsets (saio) that would need rewriting too.
      if (!(tfhdFlags & 0x020000) || tfhdFlags & 0x000001 || inner.some(entry => entry.type === "saio")) return null;
      // Optional tfhd fields come in a fixed order: description index, default duration, default size.
      let cursor = tfhd.start + 16;
      if (tfhdFlags & 0x000002) cursor += 4;
      if (tfhdFlags & 0x000008) cursor += 4;
      const defaultSize = tfhdFlags & 0x000010 ? data.getUint32(cursor) : this.defaultSizes.get(id) ?? 0;

      // Copy the traf with its trun offsets left for patching once the new moof's size is known.
      const samples: Uint8Array[] = [];
      const trafParts: Uint8Array[] = [];
      const offsetPatches: Array<{ part: number; within: number }> = [];
      let sampleBytes = 0;
      for (const item of inner) {
        if (item.type !== "trun") {
          trafParts.push(slice(moof, item));
          continue;
        }
        const flags = data.getUint32(item.start + 8) & 0xffffff;
        const count = data.getUint32(item.start + 12);
        if (!(flags & 0x000001)) return null;
        const offset = data.getInt32(item.start + 16);
        let length = 0;
        if (flags & 0x000200) {
          const entry = (flags & 0x000100 ? 4 : 0) + 4 + (flags & 0x000400 ? 4 : 0) + (flags & 0x000800 ? 4 : 0);
          let field = item.start + 20 + (flags & 0x000004 ? 4 : 0) + (flags & 0x000100 ? 4 : 0);
          for (let index = 0; index < count; index++, field += entry) length += data.getUint32(field);
        } else {
          if (!defaultSize) return null;
          length = defaultSize * count;
        }
        // The muxed offset is from the moof's start; the mdat's payload begins 8 bytes into it.
        const from = offset - moof.length - 8;
        if (from < 0 || from + length > mdat.length - 8) return null;
        samples.push(mdat.subarray(8 + from, 8 + from + length));
        const copy = moof.slice(item.start, item.start + item.size);
        view(copy).setInt32(16, sampleBytes);
        offsetPatches.push({ part: trafParts.length, within: 16 });
        trafParts.push(copy);
        sampleBytes += length;
      }
      const moofSize = 8 + mfhd.size + 8 + trafParts.reduce((sum, part) => sum + part.length, 0);
      for (const patch of offsetPatches) {
        const part = view(trafParts[patch.part]);
        part.setInt32(patch.within, part.getInt32(patch.within) + moofSize + 8);
      }
      out[kind].push(box("moof", [slice(moof, mfhd), box("traf", trafParts)]), box("mdat", samples));
    }
    return { video: concat(out.video), audio: concat(out.audio) };
  }
}
