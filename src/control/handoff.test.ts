import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceLoginPoll } from "../api/deviceLogin";
import type { Session } from "../types";
import { END_AFTER_PLAYER_MS, HandoffManager, LAUNCH_TIMEOUT_MS, type HandoffApi } from "./handoff";
import type { Envelope, HandoffOffer } from "./protocol";

const SERVER = "https://silo.example.com";
const offer = (profileId = "p-sam", extra: Partial<HandoffOffer> = {}): HandoffOffer => ({
  requestId: "r1", serverId: "c2lsbw", serverURL: SERVER, profileId, profileName: "Sam", ...extra
});
const phone = { deviceId: "phone-1", deviceName: "Sam's phone", features: ["resume_token"] };
const approved = (profileId = "p-sam"): DeviceLoginPoll => ({
  status: "approved", access_token: "acc", refresh_token: "ref", profile_id: profileId, profile_token: "pin-proof",
  temporary: true, session_expires_at: "2030-01-01T00:00:00Z", user: { id: "u-1", username: "sam" }
});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
/** Lets the handoff run a few polls (each test sleep is one tick). */
const flush = async () => { for (let i = 0; i < 12; i += 1) await tick(); };

function setup(polls: DeviceLoginPoll[] = [{ status: "pending" }, approved()], overrides: Partial<HandoffApi> = {}) {
  const sent: Array<{ id: string; message: Envelope }> = [];
  const ready: string[] = [];
  const unready: string[] = [];
  const logouts: Session[] = [];
  const cancels: string[] = [];
  let closes = 0;
  let tokens = 0;
  const queue = [...polls];
  const api: HandoffApi = {
    capability: vi.fn(async () => ({ state: "available", remote_playback_handoff: true, protocol_versions: [2] })),
    start: vi.fn(async () => ({
      device_code: "dev-code", user_code: "ABCD-EFGH", match_code: "42", verification_uri: "", verification_uri_complete: "",
      expires_at: "2030-01-01T00:10:00Z", expires_in: 600, interval: 2, device_name: "TV", device_platform: "webOS",
      client_purpose: "remote_playback", temporary: true
    })),
    poll: vi.fn(async () => queue.shift() ?? { status: "pending" }),
    cancel: vi.fn(async (_url: string, code: string) => { cancels.push(code); }),
    logout: vi.fn(async (session: Session) => { logouts.push({ ...session }); }),
    settle: vi.fn(async () => undefined),
    ...overrides
  };
  const manager = new HandoffManager({
    serverUrl: SERVER,
    deviceName: () => "Living room TV",
    api,
    send: (id, message) => sent.push({ id, message }),
    ready: (id, profileId) => ready.push(`${id}:${profileId}`),
    unready: (id, profileId) => unready.push(`${id}:${profileId}`),
    closePlayer: () => { closes += 1; },
    randomToken: () => `resume-${++tokens}`,
    now: () => Date.now(),
    sleep: () => tick()
  });
  const of = (type: string) => sent.filter(entry => entry.message.type === type).map(entry => entry.message);
  return { manager, api, sent, ready, unready, logouts, cancels, of, closes: () => closes };
}

describe("HandoffManager (#156)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(new Date("2029-12-31T12:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("asks the server for a temporary sign-in, sends the codes, and is ready once the phone approves", async () => {
    const t = setup();
    t.manager.offer("c1", offer(), phone);
    await flush();
    expect(t.api.start).toHaveBeenCalledWith(SERVER, "Living room TV");
    expect(t.of("handoff_challenge")).toMatchObject([{ handoffChallenge: { requestId: "r1", userCode: "ABCD-EFGH", matchCode: "42" } }]);
    expect(t.api.poll).toHaveBeenCalledTimes(2);
    expect(t.ready).toEqual(["c1:p-sam"]);
    expect(t.of("handoff_ready")).toMatchObject([{ handoffReady: { requestId: "r1", serverId: "c2lsbw", profileId: "p-sam", reused: false, resumeToken: "resume-1", sessionExpiresAt: "2030-01-01T00:00:00.000Z" } }]);
    const identity = t.manager.sessionFor("c1");
    expect(identity?.session).toMatchObject({ serverUrl: SERVER, accessToken: "acc", refreshToken: "ref", profileId: "p-sam", profileToken: "pin-proof" });
    expect(identity?.session.temporary?.ended).toBe(false);
    expect(t.manager.sessionFor("c2")).toBeNull();
  });

  it("rides out a failed poll", async () => {
    let calls = 0;
    const t = setup([], { poll: vi.fn(async () => { calls += 1; if (calls === 1) throw new Error("offline"); return approved(); }) });
    t.manager.offer("c1", offer(), phone);
    await flush();
    expect(t.ready).toEqual(["c1:p-sam"]);
    expect(t.cancels).toEqual([]);
  });

  it("cancels the login after three failed polls in a row", async () => {
    const t = setup([], { poll: vi.fn(async (): Promise<DeviceLoginPoll> => { throw new Error("offline"); }) });
    t.manager.offer("c1", offer(), phone);
    await flush();
    expect(t.api.poll).toHaveBeenCalledTimes(3);
    expect(t.cancels).toEqual(["dev-code"]);
    expect(t.of("handoff_cancel")).toMatchObject([{ handoffCancel: { requestId: "r1", reason: "handoff_failed" } }]);
    expect(t.ready).toEqual([]);
  });

  it("logs out an approval that arrives after the phone cancelled", async () => {
    let answer: (poll: DeviceLoginPoll) => void = () => undefined;
    const t = setup([], { poll: vi.fn(() => new Promise<DeviceLoginPoll>(resolve => { answer = resolve; })) });
    t.manager.offer("c1", offer(), phone);
    await flush();
    t.manager.cancel("c1", "r1");
    answer(approved());
    await flush();
    expect(t.ready).toEqual([]);
    expect(t.logouts).toMatchObject([{ accessToken: "acc", profileId: "p-sam" }]);
  });

  it("logs out with the tokens of a refresh that was on its way when the sign-in ended", async () => {
    let settled: () => void = () => undefined;
    const t = setup(undefined, { settle: vi.fn(() => new Promise<void>(resolve => { settled = resolve; })) });
    t.manager.offer("c1", offer(), phone);
    await flush();
    const identity = t.manager.sessionFor("c1")!;
    t.manager.stop();
    await flush();
    expect(t.logouts).toEqual([]);
    // The refresh finishes after the lane closed and leaves its new pair on the lane.
    identity.lane.accessToken = "acc-2";
    identity.lane.refreshToken = "ref-2";
    settled();
    await flush();
    expect(t.logouts).toMatchObject([{ accessToken: "acc-2", refreshToken: "ref-2" }]);
    expect(identity.lane.accessToken).toBe("");
  });

  it("fails without starting when the server can't hand off", async () => {
    const t = setup([], { capability: vi.fn(async () => ({ state: "available", remote_playback_handoff: false, protocol_versions: [2] })) });
    t.manager.offer("c1", offer(), phone);
    await flush();
    expect(t.api.start).not.toHaveBeenCalled();
    expect(t.of("handoff_cancel")).toMatchObject([{ handoffCancel: { requestId: "r1", reason: "handoff_failed" } }]);
  });

  it("withdraws a login the server didn't make temporary", async () => {
    const t = setup([], {
      start: vi.fn(async () => ({
        device_code: "dev-code", user_code: "A", match_code: "1", verification_uri: "", verification_uri_complete: "", expires_at: "",
        expires_in: 600, interval: 2, device_name: "TV", device_platform: "webOS"
      }))
    });
    t.manager.offer("c1", offer(), phone);
    await flush();
    expect(t.cancels).toEqual(["dev-code"]);
    expect(t.of("handoff_challenge")).toEqual([]);
    expect(t.of("handoff_cancel")).toHaveLength(1);
  });

  it("ends with handoff_failed when the phone declines", async () => {
    const t = setup([{ status: "denied" }]);
    t.manager.offer("c1", offer(), phone);
    await flush();
    expect(t.of("handoff_cancel")).toMatchObject([{ handoffCancel: { message: "The handoff was declined on the phone." } }]);
    expect(t.ready).toEqual([]);
  });

  it("refuses an approval for another profile and logs it out", async () => {
    const t = setup([approved("p-kim")]);
    t.manager.offer("c1", offer(), phone);
    await flush();
    expect(t.ready).toEqual([]);
    expect(t.of("handoff_cancel")).toHaveLength(1);
    expect(t.logouts).toHaveLength(1);
  });

  it("cancels the server request when the phone cancels or leaves", async () => {
    const t = setup([]);
    t.manager.offer("c1", offer(), phone);
    await flush();
    t.manager.cancel("c1", "other-request");
    expect(t.cancels).toEqual([]);
    t.manager.cancel("c1");
    expect(t.cancels).toEqual(["dev-code"]);
    await flush();
    expect(t.of("handoff_cancel")).toEqual([]);
    expect(t.ready).toEqual([]);
  });

  it("reuses the sign-in for the same phone with its resume token", async () => {
    const t = setup();
    t.manager.offer("c1", offer(), phone);
    await flush();
    t.manager.offer("c2", offer("p-sam", { requestId: "r2", resumeToken: "resume-1" }), phone);
    expect(t.of("handoff_ready")[1]).toMatchObject({ handoffReady: { requestId: "r2", reused: true } });
    expect(t.api.start).toHaveBeenCalledTimes(1);
    expect(t.manager.sessionFor("c2")).not.toBeNull();
    // Another phone, or no token on a new connection, needs its own approval.
    t.manager.offer("c3", offer("p-sam", { requestId: "r3" }), phone);
    await flush();
    expect(t.api.start).toHaveBeenCalledTimes(2);
  });

  it("ends a sign-in nothing played with after the launch timeout", async () => {
    const t = setup();
    t.manager.offer("c1", offer(), phone);
    await flush();
    vi.advanceTimersByTime(LAUNCH_TIMEOUT_MS);
    await flush();
    expect(t.of("error")).toMatchObject([{ error: { code: "launch_timeout" } }]);
    expect(t.unready).toEqual(["c1:p-sam"]);
    expect(t.logouts).toMatchObject([{ accessToken: "acc", profileId: "p-sam", profileToken: "pin-proof" }]);
    expect(t.manager.sessionFor("c1")).toBeNull();
  });

  it("logs out after the player closes, unless the next episode's player opens", async () => {
    const t = setup();
    t.manager.offer("c1", offer(), phone);
    await flush();
    const identity = t.manager.sessionFor("c1")!;
    t.manager.launching(identity);
    t.manager.playerOpened(identity.lane);
    vi.advanceTimersByTime(LAUNCH_TIMEOUT_MS);
    t.manager.playerClosed(identity.lane);
    t.manager.playerOpened(identity.lane);
    vi.advanceTimersByTime(END_AFTER_PLAYER_MS);
    expect(t.logouts).toEqual([]);
    t.manager.playerClosed(identity.lane);
    vi.advanceTimersByTime(END_AFTER_PLAYER_MS);
    await flush();
    expect(t.logouts).toHaveLength(1);
    expect(identity.lane.ended).toBe(true);
    expect(identity.session.accessToken).toBe("");
  });

  it("closes the player and tells the phone when the server refuses the sign-in", async () => {
    const t = setup();
    t.manager.offer("c1", offer(), phone);
    await flush();
    const identity = t.manager.sessionFor("c1")!;
    t.manager.playerOpened(identity.lane);
    identity.lane.onRefused();
    expect(t.closes()).toBe(1);
    expect(t.of("error")).toMatchObject([{ error: { code: "temporary_session_expired" } }]);
    expect(t.manager.sessionFor("c1")).toBeNull();
  });

  it("logs everything out when it stops", async () => {
    const t = setup();
    t.manager.offer("c1", offer(), phone);
    await flush();
    t.manager.stop();
    await flush();
    expect(t.logouts).toHaveLength(1);
  });
});
