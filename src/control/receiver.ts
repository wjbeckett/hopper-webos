/**
 * The SiloControl receiver's rules (#155), after silo-roku's source/control/receiver.bs and
 * AppSceneControl.bs: hello and authorization, the command budget, the profile handoff for the
 * profile open on the TV, and who may launch. Hopper adds one step (#162): a phone on the right
 * server is held until the viewer allows it on the TV, once; after that the TV knows it. The pairing service does the sockets, pings and the
 * hello watchdog (services/pairing/control.js); the hub (hub.ts) carries out what this decides.
 */
import {
  decode, errorMessage, handoffCancel, handoffReady, PROTOCOL_VERSION, replaceConfirmationRequired, serverMatches,
  type ControlCommand, type Envelope, type HandoffOffer, type LaunchRequest, type NowPlayingSummary
} from "./protocol";

/** tvOS's command budget, as on Roku: 20 a second, bursts of 40, and a notice at most once a second. */
const COMMANDS_PER_SECOND = 20;
const COMMAND_BURST = 40;
const RATE_NOTICE_MS = 1000;
/** Android TV and Roku give an own-profile handoff a 24-hour session. */
const OWN_SESSION_MS = 24 * 60 * 60 * 1000;
/** A phone the viewer turned away isn't asked about again for this long. */
export const REFUSED_MS = 10 * 60 * 1000;
const ALLOW_FIRST = "Press OK on the TV to allow this phone.";

export type ReceiverConfig = {
  /** The signed-in server's URL, which the phones' serverId names. */
  origin: string;
  /** `server_id` from /api/v2/system/identity, once known. */
  serverIdentity?: string;
  /** A display name for the server, used in messages. */
  serverName: string;
  /** The profile open on the TV; null on the profile picker. */
  profile: { id: string; name: string } | null;
};

export type Controller = {
  id: string;
  saidHello: boolean;
  authorized: boolean;
  /** Its hello named this TV's server; it still needs allowing if the TV doesn't know it. */
  matched: boolean;
  /** The TV is asking the viewer about it. */
  asking: boolean;
  /** An offer that arrived before the phone was allowed, answered once it is. */
  heldOffer: HandoffOffer | null;
  passive: boolean;
  deviceName: string;
  deviceId: string;
  serverId: string;
  serverIdentity: string;
  features: string[];
  tokens: number;
  tokensAt: number | null;
  noticeAt: number | null;
};

export type ReceiverIo = {
  send(id: string, message: Envelope): void;
  close(id: string, reason: string): void;
  /** A phone that isn't passive is now in control: the TV says so. */
  announce(deviceName: string): void;
  /**
   * A launch the receiver allowed; the hub opens the player and answers any failure. `borrowed`:
   * the phone was made ready for its own profile through a handoff (#156), not the TV's.
   */
  launch(id: string, request: LaunchRequest, borrowed: boolean): void;
  /** An offer for a profile other than the TV's: the hub runs the server handoff (#156). */
  handoff(id: string, offer: HandoffOffer, phone: { deviceId: string; deviceName: string; features: string[] }): void;
  /** The phone cancelled an offer, or (no requestId) its connection closed. */
  handoffCancel(id: string, requestId?: string): void;
  /** The title on screen when it plays under a profile other than this one, else null. */
  playingOther(profileId: string): NowPlayingSummary | null;
  /** A control command from an authorized phone. */
  control(id: string, command: ControlCommand): void;
  /** Who is connected changed (the `playing` TXT, state ticks). */
  changed(): void;
  /** Whether the viewer has allowed this phone before (by its hello's deviceId). */
  allowed(deviceId: string): boolean;
  /** Ask the viewer to allow a phone. */
  ask(id: string, deviceName: string): void;
  /** Stop asking: answered, the phone left, or it was turned away. */
  askEnded(id: string): void;
};

export class ControlReceiver {
  private controllers = new Map<string, Controller>();
  /** The controller allowed to launch, and the profile it may launch as (`handoff_ready`). */
  private ready = new Map<string, { profileId: string; borrowed: boolean }>();
  /** The last resume token issued, reused for the same profile. */
  private issued: { profileId: string; token: string } | null = null;
  private lastState: Envelope | null = null;
  /** Phones the viewer turned away, by deviceId, until when. */
  private refused = new Map<string, number>();

  constructor(private io: ReceiverIo, private config: ReceiverConfig, private randomToken: () => string) {}

  /** A new profile, server name or identity. A phone that said hello before it was known may now match. */
  configure(config: ReceiverConfig) {
    const profileChanged = config.profile?.id !== this.config.profile?.id;
    this.config = config;
    // A phone ready for the TV's profile must ask again; one ready through a handoff keeps it.
    if (profileChanged) for (const [id, entry] of [...this.ready]) if (!entry.borrowed) this.ready.delete(id);
    for (const controller of this.controllers.values()) {
      if (controller.saidHello && !controller.matched && this.matches(controller)) {
        controller.matched = true;
        this.admit(controller);
      }
    }
    this.io.changed();
  }

  connected(id: string) {
    this.controllers.set(id, {
      id, saidHello: false, authorized: false, matched: false, asking: false, heldOffer: null, passive: false, deviceName: "", deviceId: "", serverId: "",
      serverIdentity: "", features: [], tokens: COMMAND_BURST, tokensAt: null, noticeAt: null
    });
  }

  closed(id: string) {
    const controller = this.controllers.get(id);
    if (!controller) return;
    this.controllers.delete(id);
    this.ready.delete(id);
    this.io.handoffCancel(id);
    if (controller.asking) { controller.asking = false; this.io.askEnded(id); }
    this.io.changed();
  }

  /** A handoff for the phone's own profile is done (#156): it may launch as that profile. */
  markReady(id: string, profileId: string) {
    if (!this.controllers.get(id)?.authorized) return;
    this.ready.clear();
    this.ready.set(id, { profileId, borrowed: true });
  }

  /** That borrowed sign-in ended. */
  unready(id: string, profileId: string) {
    const entry = this.ready.get(id);
    if (entry?.borrowed && entry.profileId === profileId) this.ready.delete(id);
  }

  /** The viewer allowed the phone (the hub has remembered it). */
  approve(id: string) {
    const controller = this.controllers.get(id);
    if (!controller || !controller.matched || controller.authorized) return;
    this.stopAsking(controller);
    controller.authorized = true;
    this.welcome(controller);
    const offer = controller.heldOffer;
    controller.heldOffer = null;
    if (offer) this.offer(controller, offer);
    this.io.changed();
  }

  /** The viewer turned the phone away: closed, and not asked about again for REFUSED_MS. */
  refuse(id: string, now: number) {
    const controller = this.controllers.get(id);
    if (!controller || controller.authorized) return;
    if (controller.deviceId) this.refused.set(controller.deviceId, now + REFUSED_MS);
    this.turnAway(controller, "This TV didn't allow this phone.");
  }

  /** Nobody answered: closed, but asked about again next time. */
  withdraw(id: string) {
    const controller = this.controllers.get(id);
    if (!controller || controller.authorized) return;
    this.turnAway(controller, "Nobody answered on the TV. Try again.");
  }

  /** The viewer forgot a phone (or every phone, with no deviceId): its connections close. */
  revoke(deviceId?: string) {
    for (const controller of [...this.controllers.values()]) {
      if (controller.authorized && (deviceId == null || controller.deviceId === deviceId)) this.drop(controller, "unauthorized");
    }
  }

  /** The deviceId a connection's hello gave, or "" before its hello. */
  deviceIdOf(id: string) {
    return this.controllers.get(id)?.deviceId ?? "";
  }

  authorizedCount() {
    let count = 0;
    for (const controller of this.controllers.values()) if (controller.authorized) count += 1;
    return count;
  }

  /** The latest state: sent to every authorized phone now, and to each one authorized later. */
  setState(state: Envelope) {
    this.lastState = state;
    for (const controller of this.controllers.values()) {
      if (controller.authorized) this.io.send(controller.id, state);
    }
  }

  message(id: string, raw: unknown, now: number) {
    const controller = this.controllers.get(id);
    if (!controller) return;
    const decoded = decode(raw);
    if (decoded.kind === "invalid") { this.drop(controller, ""); return; }
    if (decoded.kind === "ignored") return;
    switch (decoded.type) {
      case "ping": case "pong": case "close": return; // the pairing service handles these
      case "hello": this.hello(controller, decoded.payload, now); return;
      case "presence":
        if (controller.saidHello) {
          controller.passive = decoded.payload.passive;
          if (!controller.passive && controller.matched && !controller.authorized) this.askFor(controller);
          this.io.changed();
        }
        return;
      case "handoff_offer":
        if (!controller.saidHello) {
          this.io.send(id, handoffCancel(decoded.payload.requestId, "version_unsupported", "Update Silo on both devices to continue."));
          return;
        }
        // Hopper hands off only to the profile open on the TV, so a phone whose hello named another
        // server has nothing to prepare here (Android TV and Roku accept it for a server switch).
        if (controller.matched && !controller.authorized) {
          // Answered once the viewer allows the phone, so picking a title and pressing OK on the
          // TV is all it takes the first time.
          controller.heldOffer = decoded.payload;
          this.askFor(controller);
          return;
        }
        if (!controller.authorized) {
          this.io.send(id, handoffCancel(decoded.payload.requestId, "handoff_failed", `This TV plays from ${this.config.serverName}.`));
          return;
        }
        this.offer(controller, decoded.payload);
        return;
      case "handoff_cancel": this.io.handoffCancel(id, decoded.payload.requestId); return;
      default: break;
    }
    if (!controller.authorized) {
      if (controller.matched) {
        this.io.send(id, errorMessage("unauthorized", ALLOW_FIRST));
        this.askFor(controller);
        return;
      }
      this.io.send(id, errorMessage("unauthorized", "Connect with a matching Silo account first."));
      return;
    }
    if (decoded.type === "launch") { this.launch(controller, decoded.payload); return; }
    if (!this.allow(controller, now)) {
      if (controller.noticeAt != null && now - controller.noticeAt < RATE_NOTICE_MS) return;
      controller.noticeAt = now;
      this.io.send(id, errorMessage("rate_limited", "Too many commands. Slow down and try again."));
      return;
    }
    this.io.control(id, decoded.payload);
  }

  private hello(controller: Controller, hello: { role: string; deviceName: string; deviceId: string; serverId?: string; serverIdentity?: string; supportedVersions: number[]; features?: string[]; passive?: boolean }, now: number) {
    if (controller.saidHello) return;
    controller.features = hello.features ?? [];
    if (hello.role !== "phone" || !hello.supportedVersions.includes(PROTOCOL_VERSION) || !hello.serverId) {
      this.io.send(controller.id, errorMessage("version_unsupported", "Update Silo on both devices to continue."));
      this.drop(controller, "unauthorized");
      return;
    }
    controller.saidHello = true;
    controller.deviceName = hello.deviceName;
    controller.deviceId = hello.deviceId;
    controller.serverId = hello.serverId;
    controller.serverIdentity = (hello.serverIdentity ?? "").trim();
    controller.passive = hello.passive === true;
    controller.matched = this.matches(controller);
    // A second connection from the same phone replaces the abandoned one.
    for (const other of [...this.controllers.values()]) {
      if (other.id !== controller.id && other.deviceId && other.deviceId === controller.deviceId) this.drop(other, "replaced");
    }
    const until = this.refused.get(controller.deviceId);
    if (controller.matched && until != null && until > now) {
      this.turnAway(controller, "This TV didn't allow this phone.");
      return;
    }
    if (until != null && until <= now) this.refused.delete(controller.deviceId);
    if (controller.matched) this.admit(controller);
    this.io.changed();
  }

  /** A phone on the right server: in at once if the TV knows it, else the viewer is asked. */
  private admit(controller: Controller) {
    if (controller.deviceId && this.io.allowed(controller.deviceId)) {
      controller.authorized = true;
      this.welcome(controller);
      return;
    }
    // A silent reconnect waits until the phone is used, so the TV doesn't ask out of nowhere.
    if (!controller.passive) this.askFor(controller);
  }

  private askFor(controller: Controller) {
    if (controller.asking || controller.authorized) return;
    controller.asking = true;
    this.io.ask(controller.id, controller.deviceName);
  }

  private stopAsking(controller: Controller) {
    if (!controller.asking) return;
    controller.asking = false;
    this.io.askEnded(controller.id);
  }

  private turnAway(controller: Controller, message: string) {
    if (controller.heldOffer) this.io.send(controller.id, handoffCancel(controller.heldOffer.requestId, "handoff_failed", message));
    else this.io.send(controller.id, errorMessage("unauthorized", message));
    this.drop(controller, "unauthorized");
  }

  private matches(controller: Controller) {
    return serverMatches(controller.serverId, controller.serverIdentity, this.config.origin, this.config.serverIdentity);
  }

  private welcome(controller: Controller) {
    if (this.lastState) this.io.send(controller.id, this.lastState);
    // A passive controller (a silent reconnect) isn't announced on the TV.
    if (!controller.passive) this.io.announce(controller.deviceName);
  }

  /**
   * Section 8.1: a phone on the profile open on the TV needs no handoff; the TV answers
   * handoff_ready at once with `reused: true` and makes no server request, as Android TV and Roku
   * do. Another profile goes to the hub for the device-login handoff (#156).
   */
  private offer(controller: Controller, offer: HandoffOffer) {
    const { requestId } = offer;
    if (!serverMatches(offer.serverId, offer.serverIdentity, this.config.origin, this.config.serverIdentity)) {
      this.io.send(controller.id, handoffCancel(requestId, "handoff_failed", `This TV plays from ${this.config.serverName}.`));
      return;
    }
    const profile = this.config.profile;
    if (!profile) {
      this.io.send(controller.id, handoffCancel(requestId, "handoff_failed", "Choose a profile on the TV first."));
      return;
    }
    // Android TV: a handoff that would replace another profile's title asks the phone first, and
    // the phone resends with `replaceConfirmed` for that title. Phones that can't ask keep
    // newest-launch-wins.
    if (controller.features.includes("replace_confirmation")) {
      const nowPlaying = this.io.playingOther(offer.profileId);
      const confirmed = offer.replaceConfirmed === true && (offer.replacingContentId || "") === (nowPlaying?.contentId || "");
      if (nowPlaying && !confirmed) {
        this.io.send(controller.id, replaceConfirmationRequired(requestId, nowPlaying));
        return;
      }
    }
    if (offer.profileId !== profile.id) {
      this.io.handoff(controller.id, offer, { deviceId: controller.deviceId, deviceName: controller.deviceName, features: controller.features });
      return;
    }
    let token: string | undefined;
    if (controller.features.includes("resume_token")) {
      if (!this.issued || this.issued.profileId !== profile.id) this.issued = { profileId: profile.id, token: this.randomToken() };
      token = this.issued.token;
    }
    // Readiness is this controller's alone (tvOS completeHandoff).
    this.ready.clear();
    this.ready.set(controller.id, { profileId: profile.id, borrowed: false });
    const expires = new Date(Date.now() + OWN_SESSION_MS).toISOString();
    this.io.send(controller.id, handoffReady(requestId, offer.serverId, profile.id, expires, true, token));
  }

  private launch(controller: Controller, request: LaunchRequest) {
    const profile = this.config.profile;
    const entry = this.ready.get(controller.id);
    if (!entry || (!entry.borrowed && entry.profileId !== profile?.id)) {
      this.io.send(controller.id, errorMessage("handoff_required", "Prepare the phone profile before playing."));
      return;
    }
    // A phone on another address of the same deployment names its own server; its hello's identity matched.
    if (!serverMatches(request.serverId, controller.serverIdentity, this.config.origin, this.config.serverIdentity)) {
      this.io.send(controller.id, errorMessage("server_mismatch", "This TV is connected to a different Silo server."));
      return;
    }
    this.io.launch(controller.id, request, entry.borrowed);
  }

  private allow(controller: Controller, now: number) {
    if (controller.tokensAt != null) {
      const elapsed = Math.max(0, now - controller.tokensAt);
      controller.tokens = Math.min(COMMAND_BURST, controller.tokens + elapsed * COMMANDS_PER_SECOND / 1000);
    }
    controller.tokensAt = now;
    if (controller.tokens < 1) return false;
    controller.tokens -= 1;
    return true;
  }

  private drop(controller: Controller, reason: string) {
    this.io.close(controller.id, reason);
    this.closed(controller.id);
  }
}
