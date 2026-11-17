/**
 * Luna calls to the bundled service's phone remote control (services/pairing/control.js, #155).
 * The service owns the sockets and mDNS; the protocol lives in src/control/.
 */
import { lunaAvailable, lunaCall, lunaSubscribe, type LunaReply } from "./luna";

const SERVICE = "luna://com.hopperapp.hopper.service";

export type ControlServiceEvent =
  | { type: "listening"; port: number }
  | { type: "connected"; id: string; peer: string }
  | { type: "message"; id: string; message: unknown }
  | { type: "closed"; id: string }
  | { type: "error"; message: string };

export type ControlServiceConfig = { hello: Record<string, unknown>; instance: string; id: string; txt: string[] };

/** Only on a TV: a desktop browser has no Luna bridge and can't listen on a socket. */
export const remoteControlAvailable = lunaAvailable;

function failed(reply: LunaReply | null) {
  return !reply || reply.returnValue === false;
}

export async function startControlService(config: ControlServiceConfig): Promise<number> {
  const reply = await lunaCall(`${SERVICE}/controlStart`, config, 8000);
  if (failed(reply)) throw new Error(String(reply?.errorText ?? "The remote control service did not start."));
  return Number(reply!.port);
}

export function subscribeControlEvents(onEvent: (event: ControlServiceEvent) => void): () => void {
  return lunaSubscribe(`${SERVICE}/controlEvents`, {}, reply => {
    const event = reply.event as ControlServiceEvent | undefined;
    if (event && typeof event === "object" && typeof event.type === "string") onEvent(event);
  });
}

export function updateControlService(update: { hello?: Record<string, unknown>; txt?: string[] }) {
  return lunaCall(`${SERVICE}/controlUpdate`, update);
}

export function sendControlMessage(id: string, message: Record<string, unknown>) {
  return lunaCall(`${SERVICE}/controlSend`, { id, message });
}

export function closeControlConnection(id: string, reason: string) {
  return lunaCall(`${SERVICE}/controlClose`, { id, reason });
}

export function stopControlService() {
  return lunaCall(`${SERVICE}/controlStop`, {});
}
