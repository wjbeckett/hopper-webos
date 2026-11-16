import { describe, expect, it } from "vitest";
import { serverIdOf, type Envelope } from "./protocol";
import { ControlReceiver, type ReceiverConfig } from "./receiver";

const ORIGIN = "https://silo.example.com";
const config: ReceiverConfig = { origin: ORIGIN, serverName: "Home", serverIdentity: "dep-1", profile: { id: "p-alex", name: "Alex" } };

function setup(overrides: Partial<ReceiverConfig> = {}) {
  const sent: Array<{ id: string; message: Envelope }> = [];
  const closed: Array<{ id: string; reason: string }> = [];
  const launches: string[] = [];
  const commands: string[] = [];
  const notices: string[] = [];
  const receiver = new ControlReceiver({
    send: (id, message) => sent.push({ id, message }),
    close: (id, reason) => closed.push({ id, reason }),
    announce: name => notices.push(name),
    launch: (_id, request) => launches.push(request.playback.contentId),
    control: (_id, command) => commands.push(command.name),
    changed: () => undefined
  }, { ...config, ...overrides }, () => "token-1");
  const of = (id: string, type: string) => sent.filter(entry => entry.id === id && entry.message.type === type).map(entry => entry.message);
  return { receiver, sent, closed, launches, commands, notices, of };
}

const phoneHello = (deviceId: string, server = serverIdOf(ORIGIN), identity?: string) => ({
  type: "hello", v: 2,
  hello: { role: "phone", deviceName: `Phone ${deviceId}`, deviceId, serverId: server, serverIdentity: identity, supportedVersions: [2], features: ["close_reason", "resume_token"] }
});
const offer = (profileId: string) => ({ type: "handoff_offer", v: 2, handoffOffer: { requestId: "r1", serverId: serverIdOf(ORIGIN), serverURL: ORIGIN, profileId } });
const launch = { type: "launch", v: 2, launch: { serverId: serverIdOf(ORIGIN), playback: { contentId: "movie-1", startFromBeginning: false } } };

describe("ControlReceiver", () => {
  it("authorizes a phone on the same server and announces it", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    expect(t.receiver.authorizedCount()).toBe(1);
    expect(t.notices).toEqual(["Phone a"]);
  });

  it("authorizes a phone on another address of the same deployment by its identity", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a", serverIdOf("http://10.0.0.5:8080"), "dep-1"), 0);
    expect(t.receiver.authorizedCount()).toBe(1);
  });

  it("keeps a phone on another server connected but refuses its commands", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a", serverIdOf("https://other.example.com")), 0);
    t.receiver.message("c1", { type: "control", v: 2, control: { name: "pause" } }, 0);
    expect(t.commands).toEqual([]);
    expect(t.of("c1", "error")).toMatchObject([{ error: { code: "unauthorized" } }]);
  });

  it("refuses a hello without protocol 2 and closes", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", { type: "hello", v: 2, hello: { role: "phone", deviceName: "Old", deviceId: "o", serverId: "x", supportedVersions: [1] } }, 0);
    expect(t.of("c1", "error")).toMatchObject([{ error: { code: "version_unsupported" } }]);
    expect(t.closed).toEqual([{ id: "c1", reason: "unauthorized" }]);
  });

  it("gets the profile open on the TV ready with no server request, then launches", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.message("c1", launch, 0);
    expect(t.of("c1", "error")).toMatchObject([{ error: { code: "handoff_required" } }]);
    t.receiver.message("c1", offer("p-alex"), 0);
    expect(t.of("c1", "handoff_ready")).toMatchObject([{ handoffReady: { requestId: "r1", profileId: "p-alex", reused: true, resumeToken: "token-1" } }]);
    t.receiver.message("c1", launch, 0);
    expect(t.launches).toEqual(["movie-1"]);
  });

  it("refuses another profile until the handoff exists (#156)", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.message("c1", offer("p-sam"), 0);
    expect(t.of("c1", "handoff_cancel")).toMatchObject([{ handoffCancel: { reason: "handoff_failed" } }]);
    t.receiver.message("c1", launch, 0);
    expect(t.launches).toEqual([]);
  });

  it("refuses an offer on the profile picker", () => {
    const t = setup({ profile: null });
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.message("c1", offer("p-alex"), 0);
    expect(t.of("c1", "handoff_cancel")).toMatchObject([{ handoffCancel: { message: "Choose a profile on the TV first." } }]);
  });

  it("drops readiness when the profile on the TV changes", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.message("c1", offer("p-alex"), 0);
    t.receiver.configure({ ...config, profile: { id: "p-sam", name: "Sam" } });
    t.receiver.message("c1", launch, 0);
    expect(t.launches).toEqual([]);
  });

  it("replaces an older connection from the same phone", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.connected("c2");
    t.receiver.message("c2", phoneHello("a"), 0);
    expect(t.closed).toEqual([{ id: "c1", reason: "replaced" }]);
    expect(t.receiver.authorizedCount()).toBe(1);
  });

  it("sends the latest state to a phone when it is authorized", () => {
    const t = setup();
    t.receiver.setState({ type: "state", v: 2, state: { title: "Ready" } });
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    expect(t.of("c1", "state")).toHaveLength(1);
  });

  it("holds commands to tvOS's budget and says so once a second", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    for (let i = 0; i < 45; i++) t.receiver.message("c1", { type: "control", v: 2, control: { name: "pause" } }, 100);
    expect(t.commands).toHaveLength(40);
    expect(t.of("c1", "error")).toMatchObject([{ error: { code: "rate_limited" } }]);
    t.receiver.message("c1", { type: "control", v: 2, control: { name: "pause" } }, 1100);
    expect(t.commands).toHaveLength(41);
  });

  it("closes on a malformed message", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", { type: "launch", launch: {} }, 0);
    expect(t.closed).toEqual([{ id: "c1", reason: "" }]);
  });
});
