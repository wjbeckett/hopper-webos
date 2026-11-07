/**
 * Client for the bundled companion-pairing JS service (services/pairing).
 * The service advertises `_silopair-roku._tcp` and carries the phone's pairing
 * frames; this module only wraps its Luna calls. Protocol decisions (device
 * login, codes, results) are made by the caller.
 */

const SERVICE = "luna://org.siloserver.webos.pairing";

/** Pairing messages as sent on the wire (see Android `PairingMessage`). */
export type PairingMessage =
  | { type: "pushServer"; serverURL: string; serverName?: string; serverIdentity?: string; endpoints?: Array<{ url: string; kind: string }> }
  | { type: "deviceStarted"; serverURL: string; userCode: string; matchCode: string }
  | { type: "serverResult"; serverURL: string; status: "signedIn" | "failed"; error?: string }
  | { type: "done" }
  | { type: "cancel"; reason: string }
  | { type: string; [key: string]: unknown };

export type PairingEvent =
  | { seq: number; type: "connected" | "disconnected"; message: null }
  | { seq: number; type: "message"; message: PairingMessage };

type PalmBridge = {
  onservicecallback: ((raw: string) => void) | null;
  call: (uri: string, params: string) => void;
};

declare const PalmServiceBridge: { new (): PalmBridge } | undefined;

/** True only on a webOS TV (or emulator); in a browser pairing is unavailable. */
export function pairingAvailable(): boolean {
  return typeof PalmServiceBridge !== "undefined";
}

function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof PalmServiceBridge === "undefined") {
      reject(new Error("Phone pairing needs a webOS TV."));
      return;
    }
    const bridge = new PalmServiceBridge();
    bridge.onservicecallback = (raw) => {
      try {
        const reply = JSON.parse(raw) as T & { returnValue?: boolean; errorText?: string };
        if (reply.returnValue === false) reject(new Error(reply.errorText || `${method} failed`));
        else resolve(reply);
      } catch {
        reject(new Error(`${method}: unreadable reply`));
      }
    };
    bridge.call(`${SERVICE}/${method}`, JSON.stringify(params));
  });
}

/** Starts advertising; resolves once the TV is visible to phones. */
export function startPairing(name: string, id: string) {
  return call<{ port: number }>("start", { name, id });
}

export function stopPairing() {
  return call("stop").catch(() => undefined);
}

export function pollPairing(since: number) {
  return call<{ events: PairingEvent[]; connected: boolean; error: string }>("poll", { since });
}

export function sendPairingMessage(message: PairingMessage) {
  return call("send", { message });
}

export function closePairingConnection() {
  return call("closeConnection").catch(() => undefined);
}
