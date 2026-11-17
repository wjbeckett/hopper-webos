/**
 * Another profile's handoff (#156; silo-roku docs/silocontrol.md sections 8.2 and 8.3, Android TV
 * RemotePlaybackIdentityManager): a temporary device login the phone approves for its own profile,
 * and the borrowed sign-in it gives, held in memory for that phone's playback only.
 *
 * Nothing here logs the device code, user code, match code, tokens or resume token.
 */
import type { DeviceLoginCapability, DeviceLoginPoll, RemotePlaybackStart } from "../api/deviceLogin";
import type { Session, TemporaryLane } from "../types";
import { envelope, handoffCancel, handoffReady, PROTOCOL_VERSION, type Envelope, type HandoffOffer } from "./protocol";

/** A borrowed sign-in with no launch is ended after this long (`error launch_timeout`). */
export const LAUNCH_TIMEOUT_MS = 60 * 1000;
/** After its player closes, the sign-in waits this long for the next episode's player, then ends. */
export const END_AFTER_PLAYER_MS = 5 * 1000;
const DEFAULT_SESSION_MS = 24 * 60 * 60 * 1000;
const MAX_TIMER_MS = 2147483647;

export type HandoffApi = {
  capability(serverUrl: string): Promise<DeviceLoginCapability>;
  start(serverUrl: string, deviceName: string): Promise<RemotePlaybackStart>;
  poll(serverUrl: string, deviceCode: string): Promise<DeviceLoginPoll>;
  cancel(serverUrl: string, deviceCode: string): Promise<void>;
  logout(session: Session): Promise<void>;
};

export type HandoffDeps = {
  serverUrl: string;
  deviceName(): string;
  api: HandoffApi;
  send(controllerId: string, message: Envelope): void;
  /** The phone may now launch as this profile. */
  ready(controllerId: string, profileId: string): void;
  /** The phone's borrowed readiness is gone. */
  unready(controllerId: string, profileId: string): void;
  /** A borrowed sign-in ended while its player was open: close the player. */
  closePlayer(): void;
  randomToken(): string;
  now(): number;
  sleep(ms: number): Promise<void>;
};

export type PhoneInfo = { deviceId: string; deviceName: string; features: string[] };

export type Identity = {
  session: Session;
  lane: TemporaryLane;
  profileId: string;
  profileName: string;
  deviceId: string;
  deviceName: string;
  controllerId: string;
  resumeToken: string;
  expiresAt: number;
  launched: boolean;
  players: number;
  launchTimer: ReturnType<typeof setTimeout> | null;
  endTimer: ReturnType<typeof setTimeout> | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  ended: boolean;
};

type Pending = { controllerId: string; requestId: string; deviceCode: string; cancelled: boolean };

class HandoffFailure extends Error {}

export const handoffChallenge = (requestId: string, userCode: string, matchCode: string, expiresAt: string) =>
  envelope("handoff_challenge", "handoffChallenge", { requestId, userCode, matchCode, expiresAt });

export class HandoffManager {
  private pending: Pending | null = null;
  private current: Identity | null = null;
  /** Replaced identities whose player is still open; each ends when its player closes. */
  private retiring: Identity[] = [];
  private stopped = false;

  constructor(private deps: HandoffDeps) {}

  /** The borrowed sign-in a phone may launch with, or null. */
  sessionFor(controllerId: string): Identity | null {
    const identity = this.current;
    return identity && !identity.ended && identity.controllerId === controllerId ? identity : null;
  }

  /** An offer for a profile other than the TV's. Answers the phone itself. */
  offer(controllerId: string, offer: HandoffOffer, phone: PhoneInfo) {
    if (this.stopped) return;
    const reuse = this.current;
    if (reuse && !reuse.ended && reuse.profileId === offer.profileId && reuse.deviceId === phone.deviceId && phone.deviceId
      && (reuse.controllerId === controllerId || (!!offer.resumeToken && offer.resumeToken === reuse.resumeToken))) {
      reuse.controllerId = controllerId;
      if (!reuse.launched && reuse.players === 0) this.armLaunchTimer(reuse);
      this.deps.ready(controllerId, reuse.profileId);
      this.deps.send(controllerId, this.readyMessage(reuse, offer, true, phone));
      return;
    }
    // One handoff at a time: a newer offer replaces one still waiting for the phone.
    if (this.pending) this.abandon(this.pending);
    const pending: Pending = { controllerId, requestId: offer.requestId, deviceCode: "", cancelled: false };
    this.pending = pending;
    void this.run(pending, offer, phone).catch(reason => {
      if (this.pending === pending) this.pending = null;
      if (pending.cancelled || this.stopped) return;
      const message = reason instanceof HandoffFailure ? reason.message : "The TV couldn't reach the server to switch profiles. Try again.";
      this.deps.send(controllerId, handoffCancel(offer.requestId, "handoff_failed", message));
    });
  }

  /** The phone cancelled its offer (or, with no requestId, its connection closed). */
  cancel(controllerId: string, requestId?: string) {
    const pending = this.pending;
    if (!pending || pending.controllerId !== controllerId) return;
    if (requestId != null && pending.requestId !== requestId) return;
    this.abandon(pending);
  }

  /** A player opened with this sign-in. */
  playerOpened(lane: TemporaryLane) {
    const identity = this.find(lane);
    if (!identity) return;
    identity.players += 1;
    identity.launched = true;
    this.clear(identity, "launchTimer");
    this.clear(identity, "endTimer");
  }

  /** Its player closed: the sign-in ends unless another player (the next episode) takes it up. */
  playerClosed(lane: TemporaryLane) {
    const identity = this.find(lane);
    if (!identity) return;
    identity.players = Math.max(0, identity.players - 1);
    if (identity.players > 0) return;
    this.clear(identity, "endTimer");
    identity.endTimer = setTimeout(() => { identity.endTimer = null; if (identity.players === 0) this.end(identity); }, END_AFTER_PLAYER_MS);
  }

  /** A launch is on its way for this sign-in: the launch timer no longer applies. */
  launching(identity: Identity) {
    identity.launched = true;
    this.clear(identity, "launchTimer");
  }

  /** That launch failed before a player opened: the launch timer runs again. */
  launchFailed(identity: Identity) {
    if (!identity.ended && identity.players === 0) { identity.launched = false; this.armLaunchTimer(identity); }
  }

  /** Sign-out, server change or the receiver stopping: everything ends. */
  stop() {
    this.stopped = true;
    if (this.pending) this.abandon(this.pending);
    for (const identity of [...this.retiring, ...(this.current ? [this.current] : [])]) this.end(identity);
  }

  private async run(pending: Pending, offer: HandoffOffer, phone: PhoneInfo) {
    const { api, serverUrl } = this.deps;
    const capability = await api.capability(serverUrl);
    if (capability.state !== "available" || capability.allowed === false || capability.remote_playback_handoff !== true
      || !(capability.protocol_versions ?? []).includes(PROTOCOL_VERSION)) {
      throw new HandoffFailure("This server can't switch the TV to your profile.");
    }
    if (pending.cancelled) return;
    const started = await api.start(serverUrl, this.deps.deviceName());
    if (pending.cancelled) { void api.cancel(serverUrl, started.device_code).catch(() => undefined); return; }
    if (started.client_purpose !== "remote_playback" || started.temporary !== true || !started.device_code) {
      void api.cancel(serverUrl, started.device_code).catch(() => undefined);
      throw new HandoffFailure("This server can't switch the TV to your profile.");
    }
    pending.deviceCode = started.device_code;
    this.deps.send(pending.controllerId, handoffChallenge(offer.requestId, started.user_code, started.match_code, started.expires_at));

    const deadline = this.deps.now() + Math.max(1, started.expires_in) * 1000;
    let wait = Math.max(1, started.interval || 1);
    while (this.deps.now() < deadline) {
      await this.deps.sleep(wait * 1000);
      if (pending.cancelled || this.stopped) return;
      const poll = await api.poll(serverUrl, started.device_code);
      if (pending.cancelled || this.stopped) return;
      if (poll.status === "pending") { wait = Math.max(1, poll.poll_after ?? started.interval ?? 1); continue; }
      if (poll.status === "approved") { this.approved(pending, offer, phone, poll); return; }
      if (poll.status === "denied") throw new HandoffFailure("The handoff was declined on the phone.");
      throw new HandoffFailure("The handoff expired. Try again.");
    }
    throw new HandoffFailure("The handoff expired. Try again.");
  }

  private approved(pending: Pending, offer: HandoffOffer, phone: PhoneInfo, poll: DeviceLoginPoll) {
    if (this.pending === pending) this.pending = null;
    const accessToken = poll.tokens?.access_token ?? poll.access_token;
    const refreshToken = poll.tokens?.refresh_token ?? poll.refresh_token;
    if (!accessToken || !refreshToken || poll.temporary !== true || poll.profile_id !== offer.profileId) {
      // Don't leave an unusable session open on the server.
      if (accessToken) {
        void this.deps.api.logout({ serverUrl: this.deps.serverUrl, accessToken, profileId: poll.profile_id, profileToken: poll.profile_token, userId: "", username: "" }).catch(() => undefined);
      }
      throw new HandoffFailure("The server approved a different profile.");
    }
    const parsed = poll.session_expires_at ? Date.parse(poll.session_expires_at) : NaN;
    const expiresAt = Number.isFinite(parsed) ? parsed : this.deps.now() + DEFAULT_SESSION_MS;
    let identity: Identity;
    const lane: TemporaryLane = { accessToken, refreshToken, ended: false, onRefused: () => this.expire(identity) };
    const user = poll.tokens?.user ?? poll.user;
    identity = {
      session: {
        serverUrl: this.deps.serverUrl, accessToken, refreshToken, profileId: poll.profile_id, profileToken: poll.profile_token,
        profileMetadataLoaded: true, userId: user?.id ?? "", username: user?.username ?? "", temporary: lane
      },
      lane, profileId: poll.profile_id, profileName: (offer.profileName ?? "").trim(), deviceId: phone.deviceId,
      deviceName: phone.deviceName, controllerId: pending.controllerId, resumeToken: this.deps.randomToken(), expiresAt,
      launched: false, players: 0, launchTimer: null, endTimer: null, expiryTimer: null, ended: false
    };
    // One borrowed sign-in at a time; one still playing ends when its player closes.
    const previous = this.current;
    if (previous) {
      this.deps.unready(previous.controllerId, previous.profileId);
      if (previous.players > 0) this.retiring.push(previous);
      else this.end(previous);
    }
    this.current = identity;
    identity.expiryTimer = setTimeout(() => this.expire(identity), Math.min(MAX_TIMER_MS, Math.max(0, expiresAt - this.deps.now())));
    this.armLaunchTimer(identity);
    this.deps.ready(pending.controllerId, identity.profileId);
    this.deps.send(pending.controllerId, this.readyMessage(identity, offer, false, phone));
  }

  private readyMessage(identity: Identity, offer: HandoffOffer, reused: boolean, phone: PhoneInfo) {
    const token = phone.features.includes("resume_token") ? identity.resumeToken : undefined;
    return handoffReady(offer.requestId, offer.serverId, identity.profileId, new Date(identity.expiresAt).toISOString(), reused, token);
  }

  private armLaunchTimer(identity: Identity) {
    this.clear(identity, "launchTimer");
    identity.launchTimer = setTimeout(() => {
      identity.launchTimer = null;
      if (identity.launched || identity.players > 0 || identity.ended) return;
      this.deps.send(identity.controllerId, envelope("error", "error", { code: "launch_timeout", message: "Nothing was played on the TV in time. Try again." }));
      this.end(identity);
    }, LAUNCH_TIMEOUT_MS);
  }

  /** The server refused a refresh, or the session reached its end. */
  private expire(identity: Identity) {
    if (identity.ended) return;
    this.deps.send(identity.controllerId, envelope("error", "error", { code: "temporary_session_expired", message: "The phone profile session expired." }));
    if (identity.players > 0) this.deps.closePlayer();
    this.end(identity);
  }

  private end(identity: Identity) {
    if (identity.ended) return;
    identity.ended = true;
    this.clear(identity, "launchTimer");
    this.clear(identity, "endTimer");
    this.clear(identity, "expiryTimer");
    if (this.current === identity) {
      this.current = null;
      this.deps.unready(identity.controllerId, identity.profileId);
    }
    this.retiring = this.retiring.filter(entry => entry !== identity);
    // Logged out once, before the lane closes; never retried. Then the tokens are forgotten.
    const session = identity.session;
    void this.deps.api.logout(session).catch(() => undefined).finally(() => {
      identity.lane.ended = true;
      identity.lane.accessToken = "";
      identity.lane.refreshToken = "";
      session.accessToken = "";
      session.refreshToken = "";
      session.profileToken = undefined;
    });
    identity.lane.ended = true;
  }

  private abandon(pending: Pending) {
    pending.cancelled = true;
    if (this.pending === pending) this.pending = null;
    if (pending.deviceCode) void this.deps.api.cancel(this.deps.serverUrl, pending.deviceCode).catch(() => undefined);
  }

  private find(lane: TemporaryLane) {
    if (this.current?.lane === lane) return this.current;
    return this.retiring.find(identity => identity.lane === lane) ?? null;
  }

  private clear(identity: Identity, timer: "launchTimer" | "endTimer" | "expiryTimer") {
    const handle = identity[timer];
    if (handle != null) clearTimeout(handle);
    identity[timer] = null;
  }
}
