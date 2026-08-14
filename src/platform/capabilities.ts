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

export function probePlaybackCapabilities(): WebOsPlaybackCapabilities {
  const video = document.createElement("video");
  const codecs: Record<string, boolean> = {};

  for (const [name, mime] of Object.entries(MIME_TESTS)) {
    const result = video.canPlayType(mime);
    codecs[name] = result === "probably" || result === "maybe";
  }

  return {
    platform: "webOS",
    userAgent: navigator.userAgent,
    codecs,
    mediaSource: "MediaSource" in window,
    eme: "requestMediaKeySystemAccess" in navigator
  };
}
