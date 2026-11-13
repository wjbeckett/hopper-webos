/**
 * Whether the screen can show HDR, for the playback request's `hdr` claims.
 *
 * Chrome 87 (webOS 22) has no `(dynamic-range: high)` media query; it matches neither "high"
 * nor "standard" there, so on its own it reported every LG TV as SDR and Silo converted HDR
 * titles to SDR. The TV's config service answers instead (`tv.model.supportHDR`, the key LG's
 * own `webOS.deviceInfo` reads for `hdr10`). Asked once at start-up; a playback request made
 * before the answer arrives falls back to the media query.
 */
type PalmBridge = { onservicecallback: ((raw: string) => void) | null; call: (uri: string, params: string) => void };
declare const PalmServiceBridge: { new (): PalmBridge } | undefined;

let configSaysHdr: boolean | null = null;
let asked = false;

/** Asks the TV once. Does nothing in a desktop browser. */
export function probeDisplayHdr() {
  if (asked || typeof PalmServiceBridge === "undefined") return;
  asked = true;
  try {
    const bridge = new PalmServiceBridge();
    bridge.onservicecallback = raw => {
      try {
        const reply = JSON.parse(raw) as { returnValue?: boolean; configs?: Record<string, unknown> };
        const value = reply.configs?.["tv.model.supportHDR"];
        if (typeof value === "boolean") configSaysHdr = value;
      } catch { /* unreadable reply: keep the media query */ }
    };
    bridge.call("luna://com.webos.service.config/getConfigs", JSON.stringify({ configNames: ["tv.model.supportHDR"] }));
  } catch { /* no config service: keep the media query */ }
}

export function displaySupportsHdr(): boolean {
  if (configSaysHdr != null) return configSaysHdr;
  try { return typeof matchMedia === "function" && matchMedia("(dynamic-range: high)").matches; } catch { return false; }
}
