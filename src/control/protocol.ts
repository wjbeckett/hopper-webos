/**
 * SiloControl v2 on the wire: what a Silo phone app sends a TV, and what the TV answers (#155).
 * Hopper is a receiver like the Roku app (silo-roku docs/silocontrol.md section 6); the message
 * types, fields, error codes and close reasons are the Apple and Android TVs'
 * (silo-android shared/.../cast/SiloCastMessage.kt). Pure: no I/O.
 */

export const PROTOCOL_VERSION = 2;

/**
 * The TV hello's features. Hopper can mute but can't set the TV's volume, as on Roku
 * (`volume_mute_only`). It has playback speed, so it doesn't send `no_playback_speed`.
 */
export const TV_FEATURES = ["multi_controller", "close_reason", "resume_token", "presence", "volume_mute_only"];

const COMMAND_NAMES = [
  "play", "pause", "play_pause", "seek", "stop", "select_audio_track", "select_subtitle_track",
  "set_playback_speed", "set_quality", "set_video_gravity", "set_subtitle_sync_ms",
  "set_subtitle_position", "set_volume", "set_muted", "play_next"
];

export type PhoneHello = {
  role: string; deviceName: string; deviceId: string; serverId?: string; serverName?: string;
  serverIdentity?: string; supportedVersions: number[]; features?: string[]; passive?: boolean;
};
export type HandoffOffer = {
  requestId: string; serverId: string; serverURL: string; profileId: string; profileName?: string;
  serverIdentity?: string; resumeToken?: string; replaceConfirmed?: boolean; replacingContentId?: string;
};
export type HandoffCancel = { requestId: string; reason: string; message?: string };
export type PlaybackRequest = {
  contentId: string; fileId?: number; audioTrackIndex?: number; subtitleTrackIndex?: number;
  startFromBeginning: boolean; resumePosition?: number; libraryId?: number; pinsVersion?: boolean;
};
export type LaunchRequest = { serverId: string; playback: PlaybackRequest };
export type ControlCommand = {
  name: string; seconds?: number; trackId?: number; speed?: number; volume?: number; value?: string;
  enabled?: boolean; milliseconds?: number;
};

export type Decoded =
  | { kind: "message"; type: "ping" | "pong" | "close"; payload: Record<string, never> }
  | { kind: "message"; type: "hello"; payload: PhoneHello }
  | { kind: "message"; type: "handoff_offer"; payload: HandoffOffer }
  | { kind: "message"; type: "handoff_cancel"; payload: HandoffCancel }
  | { kind: "message"; type: "launch"; payload: LaunchRequest }
  | { kind: "message"; type: "control"; payload: ControlCommand }
  | { kind: "message"; type: "presence"; payload: { passive: boolean } }
  /** An unknown type, an unknown control name, or a type only a TV sends: the connection stays. */
  | { kind: "ignored"; type: string }
  /** No type, or a known type with a malformed payload: the connection closes. */
  | { kind: "invalid" };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const absent = (value: unknown) => value === undefined || value === null;
const optString = (value: unknown) => absent(value) || isString(value);
const optBool = (value: unknown) => absent(value) || typeof value === "boolean";
const optNumber = (value: unknown) => absent(value) || (typeof value === "number" && Number.isFinite(value));
const optInt = (value: unknown) => absent(value) || Number.isInteger(value);
const isList = (value: unknown, item: (entry: unknown) => boolean) => Array.isArray(value) && value.every(item);

function validHello(value: unknown): value is PhoneHello {
  if (!isObject(value)) return false;
  if (value.role !== "phone" && value.role !== "tv") return false;
  if (!isString(value.deviceName) || !isString(value.deviceId)) return false;
  if (!isList(value.supportedVersions, Number.isInteger)) return false;
  if (![value.serverId, value.serverName, value.serverIdentity, value.clientKind].every(optString)) return false;
  return optBool(value.passive) && (absent(value.features) || isList(value.features, isString));
}

function validOffer(value: unknown): value is HandoffOffer {
  if (!isObject(value)) return false;
  if (!["requestId", "serverId", "serverURL", "profileId"].every(key => isString(value[key]))) return false;
  if (!["serverName", "profileName", "title", "serverIdentity", "resumeToken", "replacingContentId"].every(key => optString(value[key]))) return false;
  return optBool(value.replaceConfirmed);
}

function validLaunch(value: unknown): value is LaunchRequest {
  if (!isObject(value) || !isString(value.serverId)) return false;
  const wanted = value.playback;
  if (!isObject(wanted) || !isString(wanted.contentId) || typeof wanted.startFromBeginning !== "boolean") return false;
  if (!["fileId", "audioTrackIndex", "subtitleTrackIndex", "libraryId"].every(key => optInt(wanted[key]))) return false;
  return optNumber(wanted.resumePosition) && optBool(wanted.pinsVersion);
}

function validCommand(value: Json): boolean {
  return optNumber(value.seconds) && optInt(value.trackId) && optNumber(value.speed) && optNumber(value.volume)
    && optString(value.value) && optBool(value.enabled) && optInt(value.milliseconds);
}

/** One message as the phone sent it (already parsed from JSON by the pairing service). */
export function decode(message: unknown): Decoded {
  if (!isObject(message) || !isString(message.type)) return { kind: "invalid" };
  const type = message.type;
  if (type === "ping" || type === "pong" || type === "close") return { kind: "message", type, payload: {} };
  const checked = <T extends Decoded>(ok: boolean, decoded: T): Decoded => ok ? decoded : { kind: "invalid" };
  switch (type) {
    case "hello": return checked(validHello(message.hello), { kind: "message", type, payload: message.hello as PhoneHello });
    case "handoff_offer": return checked(validOffer(message.handoffOffer), { kind: "message", type, payload: message.handoffOffer as HandoffOffer });
    case "handoff_cancel": {
      const cancel = message.handoffCancel;
      return checked(isObject(cancel) && isString(cancel.requestId) && isString(cancel.reason) && optString(cancel.message), { kind: "message", type, payload: cancel as HandoffCancel });
    }
    case "launch": return checked(validLaunch(message.launch), { kind: "message", type, payload: message.launch as LaunchRequest });
    case "presence": {
      const presence = message.presence;
      return checked(isObject(presence) && typeof presence.passive === "boolean", { kind: "message", type, payload: presence as { passive: boolean } });
    }
    case "control": {
      const command = message.control;
      if (!isObject(command) || !isString(command.name)) return { kind: "invalid" };
      if (!COMMAND_NAMES.includes(command.name)) return { kind: "ignored", type };
      return checked(validCommand(command), { kind: "message", type, payload: command as ControlCommand });
    }
    default: return { kind: "ignored", type };
  }
}

// ---- What the TV sends

export type Envelope = { type: string; v: number } & Json;

export function envelope(type: string, key?: string, payload?: unknown): Envelope {
  return key ? { type, v: PROTOCOL_VERSION, [key]: payload } : { type, v: PROTOCOL_VERSION };
}

export type TvIdentity = { deviceName: string; deviceId: string; serverId: string; serverName: string; serverIdentity?: string };

/** The TV's hello payload (section 6.2). The pairing service sends it on every new connection. */
export function tvHello(identity: TvIdentity) {
  return {
    role: "tv",
    deviceName: identity.deviceName,
    deviceId: identity.deviceId,
    serverId: identity.serverId,
    serverName: identity.serverName,
    ...(identity.serverIdentity ? { serverIdentity: identity.serverIdentity } : {}),
    supportedVersions: [PROTOCOL_VERSION],
    features: TV_FEATURES
  };
}

export const errorMessage = (code: string, message: string) => envelope("error", "error", { code, message });

export function handoffReady(requestId: string, serverId: string, profileId: string, sessionExpiresAt: string, reused: boolean, resumeToken?: string) {
  return envelope("handoff_ready", "handoffReady", { requestId, serverId, profileId, sessionExpiresAt, reused, ...(resumeToken ? { resumeToken } : {}) });
}

export const handoffCancel = (requestId: string, reason: string, message: string) =>
  envelope("handoff_cancel", "handoffCancel", { requestId, reason, message });

// ---- Servers (section 6.2)

const trimUrl = (url: string) => url.trim().replace(/\/+$/, "");

/** The phones' key for a server: base64url, without padding, of its URL with trailing slashes trimmed. */
export function serverIdOf(url: string): string {
  const bytes = new TextEncoder().encode(trimUrl(url));
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function urlOfServerId(id: string): string | null {
  try {
    let text = id.replace(/-/g, "+").replace(/_/g, "/");
    while (text.length % 4) text += "=";
    const binary = atob(text);
    const url = trimUrl(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    return /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** scheme://host[:port]/path with the scheme and host lowercased and a default port dropped. */
function comparable(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether a phone's server is the TV's, by its key or by the deployment's identity. */
export function serverMatches(id: unknown, identity: unknown, origin: string, ownIdentity?: string): boolean {
  if (isString(id) && id && origin) {
    if (id === serverIdOf(origin)) return true;
    const url = urlOfServerId(id);
    const ours = comparable(origin);
    if (url && ours && comparable(url) === ours) return true;
  }
  const theirs = isString(identity) ? identity.trim() : "";
  return theirs !== "" && theirs === (ownIdentity ?? "").trim();
}

// ---- State (section 6.4)

export type RemoteTrack = { trackId: number; title: string; detail?: string };
export type RemoteSnapshot = {
  contentId: string; sessionId?: string; title: string; subtitle?: string;
  currentTime: number; duration: number; isPlaying: boolean; isLoading: boolean; isBuffering: boolean;
  error?: string; audioTracks: RemoteTrack[]; selectedAudioTrackId?: number;
  subtitleTracks: RemoteTrack[]; selectedSubtitleTrackId?: number;
  qualityOptions: Array<{ id: string; label: string; detail?: string }>; activeQualityId: string;
  isQualitySwitching: boolean; playbackSpeed: number; isMuted: boolean;
  hasNextEpisode: boolean; nextEpisodeTitle?: string;
};

const text = (value: string | undefined) => value ? value : null;
const seconds = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;

/**
 * The state frame's body. Every key the Android phone requires is present, or its decoder fails
 * and drops the session. Image URLs and the overview are never sent, as on Roku.
 */
export function stateBody(snapshot: RemoteSnapshot) {
  const tracks = (kind: string, list: RemoteTrack[]) => list.map(track => ({ kind, trackId: track.trackId, title: track.title, detail: text(track.detail) }));
  return {
    contentId: text(snapshot.contentId),
    sessionId: text(snapshot.sessionId),
    title: snapshot.title,
    subtitle: text(snapshot.subtitle),
    isPlaying: snapshot.isPlaying,
    isLoading: snapshot.isLoading,
    isBuffering: snapshot.isBuffering,
    currentTime: seconds(snapshot.currentTime),
    duration: seconds(snapshot.duration),
    audioTracks: tracks("audio", snapshot.audioTracks),
    subtitleTracks: tracks("subtitle", snapshot.subtitleTracks),
    selectedAudioTrackId: snapshot.selectedAudioTrackId ?? null,
    selectedSubtitleTrackId: snapshot.selectedSubtitleTrackId ?? null,
    qualityOptions: snapshot.qualityOptions.map(option => ({ id: option.id, label: option.label, detail: text(option.detail) })),
    activeQualityId: snapshot.activeQualityId || "auto",
    isQualitySwitching: snapshot.isQualitySwitching,
    playbackSpeed: snapshot.playbackSpeed > 0 ? snapshot.playbackSpeed : 1,
    videoGravity: "fit",
    hdrEnabled: false,
    supportsVideoGravity: false,
    supportsHDRToggle: false,
    supportsSubtitleDelay: false,
    supportsSubtitlePosition: false,
    volume: snapshot.isMuted ? 0 : 1,
    isMuted: snapshot.isMuted,
    hasNextEpisode: snapshot.hasNextEpisode,
    nextEpisodeTitle: text(snapshot.nextEpisodeTitle),
    error: text(snapshot.error)
  };
}

const EMPTY: RemoteSnapshot = {
  contentId: "", title: "", currentTime: 0, duration: 0, isPlaying: false, isLoading: false, isBuffering: false,
  audioTracks: [], subtitleTracks: [], qualityOptions: [], activeQualityId: "auto", isQualitySwitching: false,
  playbackSpeed: 1, isMuted: false, hasNextEpisode: false
};

/** With no player: the idle state tvOS and Roku send. */
export const idleState = () => stateBody({ ...EMPTY, title: "Ready" });

/** A launched title before its player reports. */
export const loadingState = (contentId: string) => stateBody({ ...EMPTY, contentId, title: "Loading", isLoading: true });

// ---- Launch (section 7.2)

export type LaunchIntent = {
  contentId: string;
  /** Undefined: where the server's resume rule says. */
  startPosition?: number;
  choices?: { fileId?: number; audioIndex?: number; subtitleIndex?: number; subtitleOff?: boolean };
};

/**
 * The player's start for a launch. Phones send a Roku-type TV the server's track numbers: the
 * audio track's index in the version, and the subtitle's combined index (negative for none),
 * which are what Hopper's PlaybackChoices take. `libraryId` is ignored.
 */
export function launchIntent(request: PlaybackRequest): LaunchIntent {
  const choices: NonNullable<LaunchIntent["choices"]> = {};
  if (request.fileId != null) choices.fileId = request.fileId;
  if (request.audioTrackIndex != null && request.audioTrackIndex >= 0) choices.audioIndex = request.audioTrackIndex;
  if (request.subtitleTrackIndex != null) {
    if (request.subtitleTrackIndex < 0) choices.subtitleOff = true;
    else choices.subtitleIndex = request.subtitleTrackIndex;
  }
  const startPosition = request.startFromBeginning ? 0
    : request.resumePosition != null && request.resumePosition > 0 ? request.resumePosition
      : undefined;
  return { contentId: request.contentId, startPosition, ...(Object.keys(choices).length ? { choices } : {}) };
}
