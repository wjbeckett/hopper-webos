/**
 * Keeps hls.js from seeking over a small gap at the very start of a stream.
 *
 * A stream whose audio is copied, not converted (Dolby, see splitSourceBuffer.ts), rarely has
 * its audio and video begin on the same instant, so the buffer starts a few milliseconds to
 * a few tenths of a second after 0. hls.js waits one 100 ms poll for playback to begin and
 * then seeks past the gap. The TV starts across such a gap by itself, and a seek rebuilds its
 * media pipeline, which costs from one to several seconds (docs/PERFORMANCE.md).
 *
 * This gives the TV START_GAP_WAIT_MS to start before hls.js is allowed its seek. Gaps
 * longer than START_GAP_MAX_SECONDS, and holes anywhere but the start, are handled by hls.js
 * as before.
 */

const START_GAP_MAX_SECONDS = 0.5;
const START_GAP_WAIT_MS = 2000;

type GapControllerShape = { media: HTMLMediaElement | null; _trySkipBufferHole(appended: unknown): number; _tryNudgeBuffer(bufferInfo: unknown): void };
type GapControllerClass = new (...args: never[]) => GapControllerShape;

/** The hls.js gap controller to use: `base` with the start-gap wait, or `base` itself if its internals are not as expected. */
export function patientGapController<T>(base: T): T {
  const Base = base as unknown as GapControllerClass | undefined;
  if (!Base || typeof Base.prototype?._trySkipBufferHole !== "function" || typeof Base.prototype._tryNudgeBuffer !== "function") return base;
  class PatientGapController extends Base {
    private startGapSeenAt = 0;

    /** True while playback has not begun, the buffer starts just after 0 and the TV still has time to start by itself. */
    private waitingOnStartGap(): boolean {
      const media = this.media;
      if (!media || media.currentTime !== 0 || media.played.length || !media.buffered.length) return false;
      const start = media.buffered.start(0);
      if (start <= 0 || start > START_GAP_MAX_SECONDS) return false;
      const now = performance.now();
      if (!this.startGapSeenAt) this.startGapSeenAt = now;
      return now - this.startGapSeenAt < START_GAP_WAIT_MS;
    }

    // The two ways hls.js moves the playhead when it is not advancing.
    _trySkipBufferHole(appended: unknown): number {
      return this.waitingOnStartGap() ? 0 : super._trySkipBufferHole(appended);
    }

    _tryNudgeBuffer(bufferInfo: unknown): void {
      if (!this.waitingOnStartGap()) super._tryNudgeBuffer(bufferInfo);
    }
  }
  return PatientGapController as unknown as T;
}
