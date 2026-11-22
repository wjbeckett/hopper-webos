import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";

vi.mock("./silo", () => ({
  mintEventsTicket: async () => ({ ticket: "t", max_connection_seconds: 3600 }),
  eventsSocketUrl: () => "wss://silo.example.com/api/v2/events"
}));

const { connectEventsSocket } = await import("./events");

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeSocket.all.push(this); }
  send() {}
  close() { this.onclose?.(); }
}

const session = { serverUrl: "https://silo.example.com", accessToken: "a", refreshToken: "r", userId: "u", username: "", profileId: "p" } as Session;
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); FakeSocket.all = []; vi.stubGlobal("WebSocket", FakeSocket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("the events socket (#193)", () => {
  it("doesn't ask for a refresh on its first connection", async () => {
    const onSignal = vi.fn();
    const stop = connectEventsSocket(session, onSignal);
    await flush();
    const socket = FakeSocket.all[0];
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "subscribed" }) });
    vi.advanceTimersByTime(5_000);
    expect(onSignal).not.toHaveBeenCalled();
    stop();
  });

  it("catches up once after a reconnect", async () => {
    const onSignal = vi.fn();
    const stop = connectEventsSocket(session, onSignal);
    await flush();
    FakeSocket.all[0].onopen?.();
    FakeSocket.all[0].onclose?.();
    vi.advanceTimersByTime(1_000);
    await flush();
    const again = FakeSocket.all[1];
    again.onopen?.();
    again.onmessage?.({ data: JSON.stringify({ type: "subscribed" }) });
    vi.advanceTimersByTime(2_000);
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith("catch-up");
    stop();
  });

  it("still passes on the server's changes", async () => {
    const onSignal = vi.fn();
    const stop = connectEventsSocket(session, onSignal);
    await flush();
    FakeSocket.all[0].onopen?.();
    FakeSocket.all[0].onmessage?.({ data: JSON.stringify({ channel: "user_state", data: { profile_id: "p" } }) });
    vi.advanceTimersByTime(2_000);
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith("change");
    stop();
  });

  it("catches up after a first attempt that failed", async () => {
    const onSignal = vi.fn();
    const stop = connectEventsSocket(session, onSignal);
    await flush();
    FakeSocket.all[0].onclose?.();
    vi.advanceTimersByTime(1_000);
    await flush();
    FakeSocket.all[1].onopen?.();
    vi.advanceTimersByTime(2_000);
    expect(onSignal).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reports a change, not a catch-up, when one arrives with the reconnect (#217)", async () => {
    const onSignal = vi.fn();
    const stop = connectEventsSocket(session, onSignal);
    await flush();
    FakeSocket.all[0].onopen?.();
    FakeSocket.all[0].onclose?.();
    vi.advanceTimersByTime(1_000);
    await flush();
    const again = FakeSocket.all[1];
    again.onopen?.();
    again.onmessage?.({ data: JSON.stringify({ channel: "catalog" }) });
    vi.advanceTimersByTime(2_000);
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith("change");
    stop();
  });
});
