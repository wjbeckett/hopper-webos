import { Fmp4Splitter, type TrackKind } from "./fmp4Split";

/**
 * Dolby audio on LG TVs.
 *
 * webOS 22 (Chrome 87) plays AC-3 and E-AC-3 through MediaSource only when the audio has a
 * buffer of its own: 'audio/mp4; codecs="ec-3"' is supported, 'video/mp4;
 * codecs="avc1.640028,ec-3"' is not. Silo's HLS segments carry audio and video together, and
 * hls.js asks for the combined buffer, which the TV refuses (bufferAddCodecError).
 *
 * This makes the combined request work. When the page asks MediaSource for a video buffer
 * with Dolby audio in it and the TV would refuse, it gets a stand-in that owns two real
 * buffers, one for video and one for audio, and splits everything appended to it between
 * them (fmp4Split.ts). hls.js is none the wiser. The audio is not decoded or converted on
 * the way, so the TV receives the original Dolby stream and can pass it to a soundbar or
 * receiver according to its own sound settings.
 *
 * It does nothing on a browser that accepts the combined buffer, or one that cannot play the
 * audio codec at all.
 */

const DOLBY = /^(ec-3|ac-3)$/i;

type Split = { video: string; audio: string };

let installed = false;
let nativeIsTypeSupported: ((type: string) => boolean) | undefined;

/** The two buffer types to use in place of `type`, or null when it should be left alone. */
function splitTypes(type: string): Split | null {
  const supported = nativeIsTypeSupported;
  if (!supported || !/^video\/mp4/i.test(type)) return null;
  const codecs = (/codecs\s*=\s*"?([^";]+)"?/i.exec(type)?.[1] ?? "").split(",").map(codec => codec.trim()).filter(Boolean);
  const audio = codecs.filter(codec => DOLBY.test(codec));
  const video = codecs.filter(codec => !DOLBY.test(codec));
  if (audio.length !== 1 || video.length !== 1 || supported(type)) return null;
  const split = { video: `video/mp4; codecs="${video[0]}"`, audio: `audio/mp4; codecs="${audio[0]}"` };
  return supported(split.video) && supported(split.audio) ? split : null;
}

type Listener = (event: Event) => void;

/** Time ranges present in both lists: what can actually be played. */
function intersect(a: TimeRanges, b: TimeRanges): TimeRanges {
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const start = Math.max(a.start(i), b.start(j));
      const end = Math.min(a.end(i), b.end(j));
      if (end > start) ranges.push([start, end]);
    }
  }
  return {
    length: ranges.length,
    start: (index: number) => ranges[index][0],
    end: (index: number) => ranges[index][1]
  };
}

/** Stands in for one SourceBuffer and feeds two. Implements the parts of the interface hls.js uses. */
class SplitSourceBuffer {
  private readonly buffers: Record<TrackKind, SourceBuffer>;
  private readonly splitter = new Fmp4Splitter();
  private readonly listeners = new Map<string, Set<Listener>>();
  /** True from appendBuffer or remove until both real buffers have finished. */
  private busy = false;

  constructor(mediaSource: MediaSource, types: Split, addSourceBuffer: (this: MediaSource, type: string) => SourceBuffer) {
    const video = addSourceBuffer.call(mediaSource, types.video);
    let audio: SourceBuffer;
    try {
      audio = addSourceBuffer.call(mediaSource, types.audio);
    } catch (error) {
      mediaSource.removeSourceBuffer(video);
      throw error;
    }
    this.buffers = { video, audio };
  }

  get real(): SourceBuffer[] { return [this.buffers.video, this.buffers.audio]; }
  get updating() { return this.busy || this.buffers.video.updating || this.buffers.audio.updating; }
  get buffered(): TimeRanges { return intersect(this.buffers.video.buffered, this.buffers.audio.buffered); }
  get mode() { return this.buffers.video.mode; }
  set mode(value: AppendMode) { this.real.forEach(buffer => { buffer.mode = value; }); }
  get timestampOffset() { return this.buffers.video.timestampOffset; }
  set timestampOffset(value: number) { this.real.forEach(buffer => { buffer.timestampOffset = value; }); }
  get appendWindowStart() { return this.buffers.video.appendWindowStart; }
  set appendWindowStart(value: number) { this.real.forEach(buffer => { buffer.appendWindowStart = value; }); }
  get appendWindowEnd() { return this.buffers.video.appendWindowEnd; }
  set appendWindowEnd(value: number) { this.real.forEach(buffer => { buffer.appendWindowEnd = value; }); }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string) {
    const event = new Event(type);
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this, event);
  }

  /** Runs `start` on each real buffer that has work, then reports one update for the pair. */
  private run(work: Array<[SourceBuffer, () => void]>) {
    this.busy = true;
    Promise.resolve().then(() => this.emit("updatestart"));
    let failed = false;
    const step = (index: number) => {
      if (index >= work.length) {
        this.busy = false;
        this.emit(failed ? "error" : "update");
        this.emit("updateend");
        return;
      }
      const [buffer, start] = work[index];
      const finish = () => {
        buffer.removeEventListener("updateend", finish);
        buffer.removeEventListener("error", fail);
        step(index + 1);
      };
      const fail = () => { failed = true; };
      buffer.addEventListener("updateend", finish);
      buffer.addEventListener("error", fail);
      try {
        start();
      } catch (error) {
        buffer.removeEventListener("updateend", finish);
        buffer.removeEventListener("error", fail);
        if (index === 0) {
          // Nothing has been appended yet: fail the call itself, as a real buffer would
          // (a full buffer throws QuotaExceededError, which the player handles).
          this.busy = false;
          throw error;
        }
        failed = true;
        step(index + 1);
      }
    };
    step(0);
  }

  appendBuffer(data: BufferSource) {
    if (this.updating) throw new DOMException("The buffer is still updating.", "InvalidStateError");
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const parts = this.splitter.push(bytes);
    if (!parts) throw new DOMException("The stream is not in a form that can be split into video and audio.", "NotSupportedError");
    const work: Array<[SourceBuffer, () => void]> = [];
    if (parts.video.length) work.push([this.buffers.video, () => this.buffers.video.appendBuffer(parts.video as BufferSource)]);
    if (parts.audio.length) work.push([this.buffers.audio, () => this.buffers.audio.appendBuffer(parts.audio as BufferSource)]);
    this.run(work);
  }

  remove(start: number, end: number) {
    if (this.updating) throw new DOMException("The buffer is still updating.", "InvalidStateError");
    this.run(this.real.map(buffer => [buffer, () => buffer.remove(start, end)] as [SourceBuffer, () => void]));
  }

  abort() {
    this.real.forEach(buffer => { try { buffer.abort(); } catch { /* not open */ } });
  }

  changeType(type: string) {
    const types = splitTypes(type);
    if (!types) throw new DOMException("The new type cannot be split into video and audio.", "NotSupportedError");
    this.buffers.video.changeType(types.video);
    this.buffers.audio.changeType(types.audio);
  }
}

/** Patches MediaSource once. Safe to call repeatedly and where MediaSource does not exist. */
export function installSplitSourceBuffer() {
  if (installed || typeof MediaSource === "undefined" || typeof MediaSource.isTypeSupported !== "function") return;
  installed = true;
  const isTypeSupported = MediaSource.isTypeSupported.bind(MediaSource);
  nativeIsTypeSupported = isTypeSupported;
  // Nothing to do where the combined buffer already works, or Dolby cannot be played at all.
  if (!splitTypes('video/mp4; codecs="avc1.640028,ec-3"') && !splitTypes('video/mp4; codecs="avc1.640028,ac-3"')) return;

  const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
  const removeSourceBuffer = MediaSource.prototype.removeSourceBuffer;
  MediaSource.isTypeSupported = (type: string) => isTypeSupported(type) || splitTypes(type) !== null;
  MediaSource.prototype.addSourceBuffer = function (this: MediaSource, type: string) {
    const types = splitTypes(type);
    if (!types) return addSourceBuffer.call(this, type);
    return new SplitSourceBuffer(this, types, addSourceBuffer) as unknown as SourceBuffer;
  };
  MediaSource.prototype.removeSourceBuffer = function (this: MediaSource, buffer: SourceBuffer) {
    if (buffer instanceof SplitSourceBuffer) {
      buffer.real.forEach(real => { try { removeSourceBuffer.call(this, real); } catch { /* already removed */ } });
      return;
    }
    removeSourceBuffer.call(this, buffer);
  };
}
