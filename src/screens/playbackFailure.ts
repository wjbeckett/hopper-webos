import type { PlaybackFailure } from "../api/playback";

/** hls.js fatal errors that mean the TV could not decode or take the media it was given. */
const DECODER_DETAILS = new Set([
  "bufferAddCodecError",
  "bufferAppendError",
  "bufferAppendingError",
  "bufferIncompatibleCodecsError",
  "fragParsingError",
  "manifestIncompatibleCodecsError",
  "fragDecryptError"
]);

/**
 * Classifies a stream failure for a `failure_recovery` replan, with Android TV's classifications
 * (TvPlayerViewModel.failureClassification): the TV could not decode or open the media →
 * decoder_failure; the server answered with an error status → http_failure, or source_unavailable
 * for a missing file; anything else → player_failure. Network loss (transport_stall) never gets
 * here: Hopper's connection check handles it.
 */
export function classifyPlaybackFailure(failure: { hlsDetails?: string; httpStatus?: number; mediaErrorCode?: number }): PlaybackFailure {
  const { hlsDetails, httpStatus, mediaErrorCode } = failure;
  if (mediaErrorCode != null) {
    const message = `media error ${mediaErrorCode}`;
    return { classification: mediaErrorCode === 3 || mediaErrorCode === 4 ? "decoder_failure" : "player_failure", message };
  }
  const message = hlsDetails ? `hls ${hlsDetails}${httpStatus ? ` (HTTP ${httpStatus})` : ""}` : "playback failure";
  if (httpStatus === 404 || httpStatus === 410) return { classification: "source_unavailable", message };
  if (httpStatus && httpStatus >= 400) return { classification: "http_failure", message };
  if (hlsDetails && DECODER_DETAILS.has(hlsDetails)) return { classification: "decoder_failure", message };
  return { classification: "player_failure", message };
}
