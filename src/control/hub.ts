/**
 * Phone remote control (SiloControl, #155): runs the receiver while someone is signed in, and
 * connects it to the bundled service (the sockets) and to the player (state and commands).
 * App.tsx starts and configures it; PlayerScreen registers itself as the player.
 */
import { cancelDeviceLogin, getDeviceLoginCapability, logoutTemporary, pollDeviceLogin, startRemotePlaybackLogin } from "../api/deviceLogin";
import { getServerIdentity } from "../api/silo";
import { allowPhone, forgetAllPhones, forgetPhone, isPhoneAllowed } from "../core/allowedPhones";
import { serverRegistry } from "../core/serverRegistry";
import { getDeviceId } from "../platform/device";
import { lunaCall } from "../platform/luna";
import {
  closeControlConnection, remoteControlAvailable, sendControlMessage, startControlService, stopControlService,
  subscribeControlEvents, updateControlService, type ControlServiceEvent
} from "../platform/remoteControl";
import type { Session, TemporaryLane } from "../types";
import { HandoffManager, type Identity } from "./handoff";
import {
  envelope, errorMessage, idleState, launchIntent, loadingState, serverIdOf, stateBody, tvHello,
  type ControlCommand, type Envelope, type LaunchIntent, type NowPlayingSummary, type RemoteSnapshot
} from "./protocol";
import { ControlReceiver, type ReceiverConfig } from "./receiver";

/** How often a playing title's state goes to the phones (tvOS, Android TV and Roku: 500 ms). */
const STATE_INTERVAL_MS = 500;
/** A launch that hasn't reached the player by then no longer blocks the next one. */
const LAUNCH_WAIT_MS = 20000;
const FALLBACK_NAME = "LG webOS TV";
/** A request to allow a phone that nobody answers is withdrawn after this long. */
const ASK_TIMEOUT_MS = 2 * 60 * 1000;

/** A phone waiting for the viewer to allow it (#162). */
export type PhoneRequest = { id: string; deviceName: string };

/** A launch for a phone's own profile (#156): the session to play with, and who it is for. */
export type BorrowedPlayback = { session: Session; profileName: string; deviceName: string };

export type CommandResult = { ok: true } | { ok: false; code: string; message: string };

/** What PlayerScreen gives the remote: its state now, and a way to apply a command. */
export type RemotePlayer = {
  snapshot(): RemoteSnapshot;
  command(command: ControlCommand): CommandResult;
};

export type RemoteControlOptions = {
  getSession(): Session | null;
  /** The profile open on the TV, or null on the profile picker. */
  profile: { id: string; name: string } | null;
  /**
   * Opens the player for a launch; rejects with a message the phone can show. `borrowed`: play
   * with the phone profile's borrowed sign-in (#156) instead of the TV's.
   */
  onLaunch(intent: LaunchIntent, borrowed?: BorrowedPlayback): Promise<void>;
  /** A borrowed sign-in expired while its player was open: close that player. */
  onBorrowedExpired(): void;
  /** A short notice on the TV ("<phone> connected"). */
  onNotice(text: string): void;
};

type Running = {
  options: RemoteControlOptions;
  receiver: ControlReceiver;
  handoff: HandoffManager;
  config: ReceiverConfig;
  identity: { deviceName: string; deviceId: string; serverId: string; serverName: string; serverIdentity?: string };
  started: boolean;
  unsubscribe: () => void;
  timer: number | null;
  lastIdle: string;
  launch: { contentId: string; at: number } | null;
};

let running: Running | null = null;
/** The open player, the profile it plays as, and its borrowed sign-in's lane if it has one (#156). */
let player: { contentId: string; adapter: RemotePlayer; at: number; profileId?: string; lane?: TemporaryLane } | null = null;
let requests: PhoneRequest[] = [];
const requestTimers = new Map<string, number>();
const requestListeners = new Set<() => void>();

function setRequests(next: PhoneRequest[]) {
  requests = next;
  requestListeners.forEach(listener => listener());
}

function endRequest(id: string) {
  const timer = requestTimers.get(id);
  if (timer != null) { window.clearTimeout(timer); requestTimers.delete(id); }
  if (requests.some(request => request.id === id)) setRequests(requests.filter(request => request.id !== id));
}

function clearRequests() {
  requestTimers.forEach(timer => window.clearTimeout(timer));
  requestTimers.clear();
  if (requests.length) setRequests([]);
}

/** Phones waiting to be allowed, oldest first. The TV asks about the first. */
export function phoneRequests() {
  return requests;
}

export function subscribePhoneRequests(listener: () => void) {
  requestListeners.add(listener);
  return () => { requestListeners.delete(listener); };
}

/**
 * The viewer's answer. An allowed phone is remembered; a refused one isn't asked about for
 * REFUSED_MS; a dismissed one (Back) is closed and may ask again.
 */
export function answerPhoneRequest(id: string, answer: "allow" | "refuse" | "dismiss") {
  const state = running;
  const request = requests.find(entry => entry.id === id);
  endRequest(id);
  if (!state || !request) return;
  if (answer === "allow") {
    const deviceId = state.receiver.deviceIdOf(id);
    if (deviceId) allowPhone(deviceId, request.deviceName);
    state.receiver.approve(id);
  } else if (answer === "refuse") {
    state.receiver.refuse(id, Date.now());
  } else {
    state.receiver.withdraw(id);
  }
}

/** Forgets one phone, closing its connection. */
export function forgetRemotePhone(deviceId: string) {
  forgetPhone(deviceId);
  running?.receiver.revoke(deviceId);
}

/** Forgets every phone, closing their connections. */
export function forgetAllRemotePhones() {
  forgetAllPhones();
  running?.receiver.revoke();
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The TV's name as the viewer set it (Settings → General → Devices → TV name), else a generic one. */
async function tvName(): Promise<string> {
  const reply = await lunaCall("luna://com.webos.service.settings/getSystemSettings", { category: "network", keys: ["deviceName"] });
  const settings = reply?.settings as { deviceName?: unknown } | undefined;
  const name = typeof settings?.deviceName === "string" ? settings.deviceName.trim() : "";
  return (name || FALLBACK_NAME).slice(0, 120);
}

function hostOf(url: string) {
  try { return new URL(url).host || url; } catch { return url; }
}

function txt(state: Running) {
  const { identity } = state;
  return [
    "v=2", `name=${identity.deviceName}`, `id=${identity.deviceId}`, `server=${identity.serverId}`,
    `serverName=${identity.serverName}`, `playing=${player ? "1" : "0"}`,
    ...(identity.serverIdentity ? [`serverIdentity=${identity.serverIdentity}`] : []),
    "sec=plain"
  ];
}

function send(id: string, message: Envelope) {
  void sendControlMessage(id, message);
}

function launchPending(state: Running) {
  if (state.launch && Date.now() - state.launch.at > LAUNCH_WAIT_MS) state.launch = null;
  return state.launch != null;
}

/** Sends the state to the phones: every tick while a title plays, once on a change otherwise. */
function publishState(state: Running) {
  if (!state.receiver.authorizedCount()) return;
  if (player) {
    // A launch is done when a player opened for it, not when the same title was already playing.
    if (state.launch && player.contentId === state.launch.contentId && player.at >= state.launch.at) state.launch = null;
    state.lastIdle = "";
    state.receiver.setState(envelope("state", "state", stateBody(player.adapter.snapshot())));
    return;
  }
  const pending = launchPending(state) ? state.launch!.contentId : "";
  const key = pending ? `loading:${pending}` : "idle";
  if (key === state.lastIdle) return;
  state.lastIdle = key;
  state.receiver.setState(envelope("state", "state", pending ? loadingState(pending) : idleState()));
}

function onEvent(state: Running, event: ControlServiceEvent) {
  if (running !== state) return;
  if (event.type === "connected") state.receiver.connected(event.id);
  else if (event.type === "closed") state.receiver.closed(event.id);
  else if (event.type === "message") state.receiver.message(event.id, event.message, Date.now());
  else if (event.type === "error") console.warn("[Hopper] remote control", event.message);
}

function applyCommand(state: Running, id: string, command: ControlCommand) {
  if (!player) {
    if (command.name !== "stop") send(id, errorMessage("player_not_ready", "Nothing is playing on the TV."));
    return;
  }
  const result = player.adapter.command(command);
  if (!result.ok) send(id, errorMessage(result.code, result.message));
  state.lastIdle = "";
  publishState(state);
}

function applyLaunch(state: Running, id: string, intent: LaunchIntent, borrowed: boolean) {
  if (launchPending(state)) {
    send(id, errorMessage("launch_pending", "A title is already starting on this TV."));
    return;
  }
  let identity: Identity | null = null;
  if (borrowed) {
    identity = state.handoff.sessionFor(id);
    if (!identity) {
      send(id, errorMessage("handoff_required", "Prepare the phone profile before playing."));
      return;
    }
    state.handoff.launching(identity);
  }
  const launch = { contentId: intent.contentId, at: Date.now() };
  state.launch = launch;
  publishState(state);
  const playback = identity ? { session: identity.session, profileName: identity.profileName, deviceName: identity.deviceName } : undefined;
  state.options.onLaunch(intent, playback).then(() => {
    if (running !== state || !playback) return;
    state.options.onNotice(`Playing as ${playback.profileName || "your profile"} · From ${playback.deviceName || "your phone"}`);
  }, reason => {
    if (running !== state) return;
    if (identity) state.handoff.launchFailed(identity);
    // Only this launch: a later one may have taken over after LAUNCH_WAIT_MS.
    if (state.launch === launch) state.launch = null;
    send(id, errorMessage("launch_failed", reason instanceof Error ? reason.message : "The TV could not play that title."));
    publishState(state);
  });
}

/** The title on screen if it plays as another profile than `profileId` (the replace confirmation). */
function nowPlayingOther(state: Running, profileId: string): NowPlayingSummary | null {
  if (!player || player.profileId === profileId) return null;
  const snapshot = player.adapter.snapshot();
  const identity = player.lane ? state.handoff.identityFor(player.lane) : null;
  return {
    contentId: snapshot.contentId || undefined,
    title: snapshot.title || "a title",
    subtitle: snapshot.subtitle || undefined,
    // A borrowed player names only its own profile; one that sent none stays unnamed ("Someone").
    profileName: (player.lane ? identity?.profileName : state.config.profile?.name) || undefined,
    controllerName: identity?.deviceName || undefined
  };
}

function updateTicking(state: Running) {
  const wanted = state.started && state.receiver.authorizedCount() > 0;
  if (wanted && state.timer == null) state.timer = window.setInterval(() => publishState(state), STATE_INTERVAL_MS);
  if (!wanted && state.timer != null) { window.clearInterval(state.timer); state.timer = null; }
}

/** Starts the receiver for this session's server. Returns the stop function. */
export function startRemoteControl(options: RemoteControlOptions): () => void {
  stopRemoteControl();
  const session = options.getSession();
  if (!session || !remoteControlAvailable()) return () => undefined;
  const origin = serverRegistry.active()?.url ?? session.serverUrl;
  const serverName = serverRegistry.active()?.name || hostOf(origin);
  const config: ReceiverConfig = { origin, serverName, profile: options.profile };
  const state: Running = {
    options, config,
    receiver: null as unknown as ControlReceiver,
    handoff: null as unknown as HandoffManager,
    identity: { deviceName: FALLBACK_NAME, deviceId: getDeviceId(), serverId: serverIdOf(origin), serverName },
    started: false, unsubscribe: () => undefined, timer: null, lastIdle: "", launch: null
  };
  state.receiver = new ControlReceiver({
    send,
    close: (id, reason) => { void closeControlConnection(id, reason); },
    announce: deviceName => { if (running === state) state.options.onNotice(`${deviceName || "A phone"} connected`); },
    launch: (id, request, borrowed) => applyLaunch(state, id, launchIntent(request.playback), borrowed),
    handoff: (id, offer, phone) => state.handoff.offer(id, offer, phone),
    handoffCancel: (id, requestId) => state.handoff.cancel(id, requestId),
    playingOther: profileId => nowPlayingOther(state, profileId),
    control: (id, command) => applyCommand(state, id, command),
    changed: () => { state.lastIdle = ""; updateTicking(state); publishState(state); },
    allowed: isPhoneAllowed,
    ask: (id, deviceName) => {
      if (running !== state) return;
      endRequest(id);
      requestTimers.set(id, window.setTimeout(() => {
        requestTimers.delete(id);
        endRequest(id);
        if (running === state) state.receiver.withdraw(id);
      }, ASK_TIMEOUT_MS));
      setRequests([...requests, { id, deviceName: deviceName.trim() || "A phone" }]);
    },
    askEnded: endRequest
  }, config, randomToken);
  state.handoff = new HandoffManager({
    serverUrl: session.serverUrl,
    deviceName: () => state.identity.deviceName,
    api: {
      capability: getDeviceLoginCapability,
      start: startRemotePlaybackLogin,
      poll: pollDeviceLogin,
      cancel: cancelDeviceLogin,
      logout: logoutTemporary
    },
    send,
    ready: (id, profileId) => state.receiver.markReady(id, profileId),
    unready: (id, profileId) => state.receiver.unready(id, profileId),
    closePlayer: () => { if (running === state) state.options.onBorrowedExpired(); },
    randomToken,
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => window.setTimeout(resolve, ms))
  });
  running = state;

  void (async () => {
    const [deviceName, serverIdentity] = await Promise.all([
      tvName(),
      getServerIdentity(session).catch(() => "")
    ]);
    if (running !== state) return;
    state.identity = { ...state.identity, deviceName, serverIdentity: serverIdentity || undefined };
    state.config = { ...state.config, serverIdentity: serverIdentity || undefined };
    state.receiver.configure(state.config);
    state.unsubscribe = subscribeControlEvents(event => onEvent(state, event));
    try {
      await startControlService({
        hello: tvHello(state.identity),
        instance: `Hopper-${state.identity.deviceId.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`,
        id: state.identity.deviceId,
        txt: txt(state)
      });
      if (running !== state) return;
      state.started = true;
      updateTicking(state);
    } catch (reason) {
      console.warn("[Hopper] remote control did not start", reason);
    }
  })();

  return () => { if (running === state) stopRemoteControl(); };
}

/** A new profile (or the profile picker): what the receiver may launch as. */
export function configureRemoteControl(profile: { id: string; name: string } | null) {
  const state = running;
  if (!state) return;
  if (state.config.profile?.id === profile?.id && state.config.profile?.name === profile?.name) return;
  state.options = { ...state.options, profile };
  state.config = { ...state.config, profile };
  state.receiver.configure(state.config);
}

export function stopRemoteControl() {
  const state = running;
  running = null;
  if (!state) return;
  if (state.timer != null) window.clearInterval(state.timer);
  clearRequests();
  state.handoff.stop();
  state.unsubscribe();
  void stopControlService();
}

/**
 * PlayerScreen while it's open, with the session it plays with. Returns the function that
 * unregisters it. A borrowed session (#156) is ended a moment after its last player closes.
 */
export function registerRemotePlayer(contentId: string, adapter: RemotePlayer, session?: Session): () => void {
  const lane = session?.temporary;
  const entry = { contentId, adapter, at: Date.now(), profileId: session?.profileId, lane };
  const handoff = running?.handoff;
  if (lane && handoff) handoff.playerOpened(lane);
  player = entry;
  const state = running;
  if (state?.started) void updateControlService({ txt: txt(state) });
  if (state) publishState(state);
  return () => {
    if (lane && handoff) handoff.playerClosed(lane);
    if (player !== entry) return;
    player = null;
    const current = running;
    if (current?.started) void updateControlService({ txt: txt(current) });
    if (current) { current.lastIdle = ""; publishState(current); }
  };
}

/** Sends the state now, after something the phone should see at once (a pause on the TV). */
export function remoteStateChanged() {
  if (running && player) publishState(running);
}
