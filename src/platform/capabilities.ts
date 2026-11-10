export type WebOsPlaybackCapabilities = {
  platform: "webOS";
  userAgent: string;
  codecs: Record<string, boolean>;
  mediaSource: boolean;
  eme: boolean;
};

const MIME_TESTS: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
  vp9: 'video/webm; codecs="vp09.00.51.08"',
  av1: 'video/mp4; codecs="av01.0.08M.08"',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  opus: 'audio/webm; codecs="opus"'
};

/**
 * Audio codecs as they appear next to video in one MP4 stream. Silo's HLS segments carry
 * audio and video together, and hls.js feeds them to a single MediaSource buffer, so the
 * codec has to be accepted in that combination and not only on its own.
 */
const MUXED_AUDIO: Record<string, string> = {
  aac: "mp4a.40.2",
  ac3: "ac-3",
  eac3: "ec-3",
  opus: "opus"
};

export function probePlaybackCapabilities(): WebOsPlaybackCapabilities {
  const video = document.createElement("video");
  const codecs: Record<string, boolean> = {};
  const mediaSource = typeof MediaSource !== "undefined" && typeof MediaSource.isTypeSupported === "function";

  for (const [name, mime] of Object.entries(MIME_TESTS)) {
    const result = video.canPlayType(mime);
    codecs[name] = result === "probably" || result === "maybe";
    // webOS 22 (Chrome 87) plays AC-3 and E-AC-3 on their own but refuses them in a buffer
    // shared with video ('video/mp4; codecs="avc1.640028,ec-3"' is unsupported). Claiming
    // them made Silo send Dolby audio untouched, and playback failed with bufferAddCodecError.
    // Not claiming them makes Silo convert the audio to a codec the TV accepts.
    const muxed = MUXED_AUDIO[name];
    if (codecs[name] && muxed && mediaSource) {
      codecs[name] = MediaSource.isTypeSupported(`video/mp4; codecs="avc1.640028,${muxed}"`);
    }
  }

  return {
    platform: "webOS",
    userAgent: navigator.userAgent,
    codecs,
    mediaSource: "MediaSource" in window,
    eme: "requestMediaKeySystemAccess" in navigator
  };
}
