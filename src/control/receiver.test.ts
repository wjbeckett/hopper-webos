import { describe, expect, it } from "vitest";
import { serverIdOf, type Envelope } from "./protocol";
import { ControlReceiver, REFUSED_MS, type ReceiverConfig } from "./receiver";

const ORIGIN = "https://silo.example.com";
const config: ReceiverConfig = { origin: ORIGIN, serverName: "Home", serverIdentity: "dep-1", profile: { id: "p-alex", name: "Alex" } };

/** Every phone is already allowed unless a test says which are. */
function setup(overrides: Partial<ReceiverConfig> = {}, known: (deviceId: string) => boolean = () => true) {
  const asks: string[] = [];
  const handoffs: Array<{ id: string; profileId: string; deviceId: string }> = [];
  const cancels: Array<{ id: string; requestId?: string }> = [];
  const borrowedLaunches: boolean[] = [];
  const sent: Array<{ id: string; message: Envelope }> = [];
  const closed: Array<{ id: string; reason: string }> = [];
  const launches: string[] = [];
  const commands: string[] = [];
  const notices: string[] = [];
  const receiver = new ControlReceiver({
    send: (id, message) => sent.push({ id, message }),
    close: (id, reason) => closed.push({ id, reason }),
    announce: name => notices.push(name),
    launch: (_id, request, borrowed) => { launches.push(request.playback.contentId); borrowedLaunches.push(borrowed); },
    handoff: (id, offered, phone) => handoffs.push({ id, profileId: offered.profileId, deviceId: phone.deviceId }),
    handoffCancel: (id, requestId) => cancels.push({ id, requestId }),
    control: (_id, command) => commands.push(command.name),
    changed: () => undefined,
    allowed: known,
    ask: id => asks.push(id),
    askEnded: id => { const at = asks.indexOf(id); if (at >= 0) asks.splice(at, 1); }
  }, { ...config, ...overrides }, () => "token-1");
  const of = (id: string, type: string) => sent.filter(entry => entry.id === id && entry.message.type === type).map(entry => entry.message);
  return { receiver, sent, closed, launches, commands, notices, asks, handoffs, cancels, borrowedLaunches, of };
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

  it("refuses an offer from a phone on another server, leaving a ready phone ready", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.message("c1", offer("p-alex"), 0);
    t.receiver.connected("c2");
    t.receiver.message("c2", phoneHello("b", serverIdOf("https://other.example.com")), 0);
    t.receiver.message("c2", offer("p-alex"), 0);
    expect(t.of("c2", "handoff_ready")).toEqual([]);
    expect(t.of("c2", "handoff_cancel")).toMatchObject([{ handoffCancel: { requestId: "r1", reason: "handoff_failed" } }]);
    t.receiver.message("c1", launch, 0);
    expect(t.launches).toEqual(["movie-1"]);
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

  it("hands another profile's offer to the hub and launches once it is ready (#156)", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.message("c1", offer("p-sam"), 0);
    expect(t.handoffs).toEqual([{ id: "c1", profileId: "p-sam", deviceId: "a" }]);
    expect(t.of("c1", "handoff_cancel")).toEqual([]);
    t.receiver.message("c1", launch, 0);
    expect(t.launches).toEqual([]);
    t.receiver.markReady("c1", "p-sam");
    t.receiver.message("c1", launch, 0);
    expect(t.launches).toEqual(["movie-1"]);
    expect(t.borrowedLaunches).toEqual([true]);
  });

  it("keeps a borrowed readiness when the TV's profile changes, and drops it when it ends", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.markReady("c1", "p-sam");
    t.receiver.configure({ ...config, profile: { id: "p-kim", name: "Kim" } });
    t.receiver.message("c1", launch, 0);
    expect(t.launches).toEqual(["movie-1"]);
    t.receiver.unready("c1", "p-sam");
    t.receiver.message("c1", launch, 0);
    expect(t.launches).toEqual(["movie-1"]);
  });

  it("passes the phone's cancel and its closing on to the hub", () => {
    const t = setup();
    t.receiver.connected("c1");
    t.receiver.message("c1", phoneHello("a"), 0);
    t.receiver.message("c1", { type: "handoff_cancel", v: 2, handoffCancel: { requestId: "r1", reason: "canceled" } }, 0);
    t.receiver.closed("c1");
    expect(t.cancels).toEqual([{ id: "c1", requestId: "r1" }, { id: "c1", requestId: undefined }]);
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
  describe("allowing a phone on the TV (#162)", () => {
    const nobody = () => false;

    it("holds a phone the TV doesn't know and asks the viewer", () => {
      const t = setup({}, nobody);
      t.receiver.connected("c1");
      t.receiver.message("c1", phoneHello("a"), 0);
      expect(t.receiver.authorizedCount()).toBe(0);
      expect(t.asks).toEqual(["c1"]);
      t.receiver.message("c1", { type: "control", v: 2, control: { name: "pause" } }, 0);
      expect(t.commands).toEqual([]);
      expect(t.of("c1", "error")).toMatchObject([{ error: { code: "unauthorized", message: "Press OK on the TV to allow this phone." } }]);
      expect(t.asks).toEqual(["c1"]);
    });

    it("lets an allowed phone in, sends it the state and answers the offer it sent while waiting", () => {
      const t = setup({}, nobody);
      t.receiver.setState({ type: "state", v: 2 } as Envelope);
      t.receiver.connected("c1");
      t.receiver.message("c1", phoneHello("a"), 0);
      t.receiver.message("c1", offer("p-alex"), 0);
      expect(t.of("c1", "handoff_ready")).toEqual([]);
      t.receiver.approve("c1");
      expect(t.asks).toEqual([]);
      expect(t.receiver.authorizedCount()).toBe(1);
      expect(t.of("c1", "state")).toHaveLength(1);
      expect(t.of("c1", "handoff_ready")).toHaveLength(1);
      expect(t.notices).toEqual(["Phone a"]);
      t.receiver.message("c1", launch, 0);
      expect(t.launches).toEqual(["movie-1"]);
    });

    it("lets a phone the TV knows straight in", () => {
      const t = setup({}, id => id === "a");
      t.receiver.connected("c1");
      t.receiver.message("c1", phoneHello("a"), 0);
      expect(t.receiver.authorizedCount()).toBe(1);
      expect(t.asks).toEqual([]);
    });

    it("doesn't ask about a phone on another server", () => {
      const t = setup({}, nobody);
      t.receiver.connected("c1");
      t.receiver.message("c1", phoneHello("a", serverIdOf("https://other.example.com")), 0);
      expect(t.asks).toEqual([]);
    });

    it("closes a refused phone and turns it away for a while without asking", () => {
      const t = setup({}, nobody);
      t.receiver.connected("c1");
      t.receiver.message("c1", phoneHello("a"), 0);
      t.receiver.message("c1", offer("p-alex"), 0);
      t.receiver.refuse("c1", 1000);
      expect(t.closed).toEqual([{ id: "c1", reason: "unauthorized" }]);
      expect(t.of("c1", "handoff_cancel")).toHaveLength(1);
      expect(t.asks).toEqual([]);
      t.receiver.connected("c2");
      t.receiver.message("c2", phoneHello("a"), 2000);
      expect(t.asks).toEqual([]);
      expect(t.closed.map(entry => entry.id)).toEqual(["c1", "c2"]);
      t.receiver.connected("c3");
      t.receiver.message("c3", phoneHello("a"), 1000 + REFUSED_MS + 1);
      expect(t.asks).toEqual(["c3"]);
    });

    it("stops asking when the phone leaves", () => {
      const t = setup({}, nobody);
      t.receiver.connected("c1");
      t.receiver.message("c1", phoneHello("a"), 0);
      t.receiver.closed("c1");
      expect(t.asks).toEqual([]);
    });

    it("waits to ask about a silent reconnect until the phone is used", () => {
      const t = setup({}, nobody);
      t.receiver.connected("c1");
      t.receiver.message("c1", { ...phoneHello("a"), hello: { ...phoneHello("a").hello, passive: true } }, 0);
      expect(t.asks).toEqual([]);
      t.receiver.message("c1", { type: "presence", v: 2, presence: { passive: false } }, 0);
      expect(t.asks).toEqual(["c1"]);
    });

    it("closes a forgotten phone", () => {
      const t = setup();
      t.receiver.connected("c1");
      t.receiver.message("c1", phoneHello("a"), 0);
      t.receiver.connected("c2");
      t.receiver.message("c2", phoneHello("b"), 0);
      t.receiver.revoke("a");
      expect(t.closed).toEqual([{ id: "c1", reason: "unauthorized" }]);
      t.receiver.revoke();
      expect(t.receiver.authorizedCount()).toBe(0);
    });
  });
});
