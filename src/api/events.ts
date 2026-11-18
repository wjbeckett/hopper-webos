import { eventsSocketUrl, mintEventsTicket } from "./silo";
import type { Session } from "../types";

const PROTOCOL = "silo.events.v2";
const CHANNELS = ["user_state", "catalog"];
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export type RealtimeSignal = () => void;

type SocketFrame = {
  type?: string;
  channel?: string;
  data?: { profile_id?: string } | null;
};

export function connectEventsSocket(session: Session, onSignal: RealtimeSignal): () => void {
  let disposed = false;
  let socket: WebSocket | undefined;
  let retryTimer: number | undefined;
  let signalTimer: number | undefined;
  let closeTimer: number | undefined;
  let backoff = INITIAL_BACKOFF_MS;
  /**
   * A connection after the first is a reconnect: what changed while it was down is caught up by
   * one signal (Android TV's HomeRealtimeEvent.Connected). The first connection is not (#193):
   * the screens have just read everything, and a catch-up then reloaded Home about 4.5 s after
   * every launch. Home's 20 s refresh, while it shows, covers the moment before it subscribes.
   * A first attempt that fails (no ticket, no socket) counts too: the connection after it catches up.
   */
  let connectedBefore = false;

  const signal = () => {
    if (signalTimer !== undefined) return;
    signalTimer = window.setTimeout(() => {
      signalTimer = undefined;
      if (!disposed) onSignal();
    }, 2_000);
  };

  const clearPending = () => {
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    if (signalTimer !== undefined) window.clearTimeout(signalTimer);
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    retryTimer = undefined;
    signalTimer = undefined;
    closeTimer = undefined;
  };

  const scheduleRetry = () => {
    if (disposed) return;
    // Anything that changed while there was no connection is caught up by the next one.
    connectedBefore = true;
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      if (disposed) return;
      if (document.visibilityState === "hidden") {
        document.addEventListener("visibilitychange", onVisible, { once: true });
        return;
      }
      void open();
    }, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  const onVisible = () => {
    if (!disposed && document.visibilityState === "visible") void open();
  };

  async function open() {
    if (disposed) return;
    let url: string;
    let ticket: Awaited<ReturnType<typeof mintEventsTicket>>;
    try {
      ticket = await mintEventsTicket(session);
      url = eventsSocketUrl(session, CHANNELS);
    } catch {
      scheduleRetry();
      return;
    }
    if (disposed) return;
    try {
      socket = new WebSocket(url, [PROTOCOL, `silo.ticket.${ticket.ticket}`]);
    } catch {
      scheduleRetry();
      return;
    }
    const reconnect = connectedBefore;
    socket.onopen = () => {
      backoff = INITIAL_BACKOFF_MS;
      connectedBefore = true;
      socket?.send(JSON.stringify({ type: "subscribe", channels: CHANNELS }));
      closeTimer = window.setTimeout(() => socket?.close(1000, "max-connection"), Math.max(1, ticket.max_connection_seconds) * 1000);
      if (reconnect) signal();
    };
    socket.onmessage = (event) => {
      let frame: SocketFrame;
      try {
        frame = JSON.parse(String(event.data)) as SocketFrame;
      } catch {
        return;
      }
      if (frame.type === "subscribed" || frame.type === "snapshot") {
        if (reconnect) signal();
        return;
      }
      if (frame.channel === "user_state" && frame.data?.profile_id && session.profileId
        && frame.data.profile_id !== session.profileId) return;
      signal();
    };
    socket.onclose = () => {
      socket = undefined;
      scheduleRetry();
    };
    socket.onerror = () => socket?.close();
  }

  void open();

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisible);
    clearPending();
    socket?.close();
    socket = undefined;
  };
}
