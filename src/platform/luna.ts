/**
 * One Luna service call through `PalmServiceBridge`, which the TV's browser provides to every
 * web app. LG's `webOSTV.js` library (`window.webOS.service.request`) wraps the same bridge, but
 * Hopper doesn't load that library, so `window.webOS` is undefined on the TV.
 *
 * Resolves with the service's reply, including a failure (`returnValue: false`), so a caller can
 * tell "the service said no" from "no answer". Resolves null when there is no bridge (a desktop
 * browser), the reply can't be read, or nothing arrives within `timeoutMs`.
 */
type PalmBridge = { onservicecallback: ((raw: string) => void) | null; call: (uri: string, params: string) => void; cancel?: () => void };
declare const PalmServiceBridge: { new (): PalmBridge } | undefined;

export type LunaReply = Record<string, unknown> & { returnValue?: boolean };

export function lunaAvailable(): boolean {
  return typeof PalmServiceBridge !== "undefined";
}

export function lunaCall(uri: string, parameters: Record<string, unknown>, timeoutMs = 2000): Promise<LunaReply | null> {
  if (!lunaAvailable()) return Promise.resolve(null);
  return new Promise(resolve => {
    let bridge: PalmBridge | null = null;
    const finish = (reply: LunaReply | null) => {
      window.clearTimeout(timer);
      if (bridge) bridge.onservicecallback = null;
      resolve(reply);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    try {
      bridge = new PalmServiceBridge!();
      bridge.onservicecallback = raw => {
        try {
          const reply = JSON.parse(raw) as LunaReply;
          finish(reply && typeof reply === "object" ? reply : null);
        } catch { finish(null); }
      };
      bridge.call(uri, JSON.stringify(parameters));
    } catch { finish(null); }
  });
}
