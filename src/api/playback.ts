import { displaySupportsHdr, localHdrEnabled } from "../core/playerSettings";
import { probePlaybackCapabilities } from "../platform/capabilities";
import type { Session, SiloItem } from "../types";
import { getDeviceId } from "../platform/device";
import { requestV2 } from "./silo";

export type AudioTrack = { index?: number; codec?: string; channels?: number; layout?: string; language?: string; title?: string; embedded_title?: string; default?: boolean };
export type SubtitleTrack = { index?: number; codec?: string; language?: string; title?: string; embedded_title?: string; forced?: boolean; hearing_impaired?: boolean; default?: boolean; external?: boolean; source?: string; file_name?: string };
export type Chapter = { index: number; title?: string; start_seconds: number; end_seconds?: number; source?: string; thumbnail_url?: string; thumbnail_thumbhash?: string };
export type FileVersion = { file_id: number; resolution?: string; codec_video?: string; codec_audio?: string; container?: string; edition_raw?: string; edition_key?: string; bitrate?: number; duration?: number; duration_seconds?: number; audio_tracks?: AudioTrack[]; subtitle_tracks?: SubtitleTrack[]; chapters?: Chapter[]; effective_audio_track_index?: number };
export type WatchDetail = { content_id: string; title: string; overview?: string; series_id?: string; series_title?: string; season_number?: number; episode_number?: number; versions: FileVersion[]; user_data?: { position_seconds?: number; last_file_id?: number } };
export type PlaybackChoices = { fileId?: number; audioIndex?: number; subtitleIndex?: number; subtitleOff?: boolean };
export type Quality = { label: string; height?: number; bitrate_kbps?: number; preserves_source: boolean };
export type SubtitleInventory = { track_id: string; combined_index: number; source: string; codec?: string; language?: string; label?: string; forced: boolean; default: boolean; hearing_impaired: boolean; delivery: string; url?: string };
export type TrackIdentity = { id: string; index?: number };
export type PlaybackPlan = {
  protocol_version: number; plan_id: string; plan_attempt_key: string; session_id: string; delivery: string;
  stream: { url: string; protocol: string; container?: string; mime_type?: string; headers?: Record<string, string> };
  timeline: { source_start_seconds: number; player_start_seconds: number; timeline_offset_seconds: number; can_seek_anywhere: boolean };
  selected_tracks: { audio?: TrackIdentity; subtitle?: TrackIdentity };
  subtitle: {
    mode: string; track_id?: string; inventory: SubtitleInventory[];
    artifact?: { url: string; format?: string; mime_type?: string; timing_origin_seconds?: number };
    embedded?: { container_track_id?: string; stream_index: number };
    hls_rendition?: { group_id: string; name: string; format?: string; mime_type?: string };
  };
  available_qualities: Quality[];
};
type Decision = { outcome: string; session_id?: string; playback_plan?: PlaybackPlan; terminal?: { message: string; reason: string } };

const features = ["playback_plan_v3", "neutral_playback_v3_contract_v1", "playback_route_diagnostics", "seek_reanchor_v1", "direct_stream_resume_v1", "plan_source_duration_v1"];
const installations = new Map<string, string>();

async function playbackInstallationId(session: Session): Promise<string> {
  const key = `${session.serverUrl}|${session.profileId ?? ""}`;
  const cached = installations.get(key);
  if (cached) return cached;
  const capabilities = await requestV2<{ installation_id?: string }>(session, "/playback/capabilities", {
    headers: { "X-Silo-Device-Id": getDeviceId() }
  });
  if (!capabilities.installation_id) throw new Error("Silo did not return a playback installation id.");
  installations.set(key, capabilities.installation_id);
  return capabilities.installation_id;
}

function cachedInstallationId(session: Session): string {
  const key = `${session.serverUrl}|${session.profileId ?? ""}`;
  const id = installations.get(key);
  if (!id) throw new Error("Playback installation has not been negotiated.");
  return id;
}
function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().toLowerCase();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

const uuid = (prefix: string) => `${prefix}:${randomUuid()}`;

function snapshot() {
  const detected = probePlaybackCapabilities();
  const video = Object.entries(detected.codecs).filter(([name, ok]) => ok && ["h264", "hevc", "vp9", "av1"].includes(name)).map(([name]) => name);
  const audio = Object.entries(detected.codecs).filter(([name, ok]) => ok && ["aac", "ac3", "eac3", "opus"].includes(name)).map(([name]) => name);
  const subtitles = { embedded_text: false, sidecar_text: true, ass_styling: false, embedded_bitmap: false, sidecar_bitmap: false, font_attachments: false };
  const delivery = (containers: string[]) => ({ enabled: true, supported_on_device: true, containers, video_codecs: video, audio_decode_codecs: audio, audio_passthrough_codecs: [], max_channels: 8, subtitles, features: [], auth_header_refresh: false, validated_claims: [], transformations: [] });
  const unavailable = { ...delivery([]), enabled: false, supported_on_device: false, failure_reason: "webos_html_video_requires_hls_execution" };
  // LG's native HTML player may report a codec as playable while still rejecting
  // its original MKV/WebM container. Do not advertise original-file execution;
  // let Silo remux/transcode to an execution route the TV can reliably open.
  const client_capabilities = { video_evidence: "declared", audio_evidence: "declared", codecs_video: video, codecs_video_hardware: [], codecs_audio: audio, containers: ["hls", "mpegts", "fmp4", "mp4", "mov", "m4v"], max_resolution: "2160p", hdr: localHdrEnabled() && displaySupportsHdr(), video_decode: [] };
  const client_playback_context = { protocol_version: 3, form_factor: "tv", app_version: "0.2.0", device: { platform: "webos", manufacturer: "LG", platform_details: { user_agent: navigator.userAgent.slice(0, 128) } }, output: {}, deliveries: { original_http: unavailable, progressive: unavailable, hls: delivery(["hls", "mpegts", "fmp4", "mp4"]) } };
  return { client_capabilities, client_playback_context };
}

function resolutionHeight(resolution?: string): number {
  const value = resolution?.trim().toLowerCase() ?? "";
  if (value === "4k" || value === "uhd" || value === "2160p") return 2160;
  const match = value.match(/(\d{3,4})p/);
  return match ? Number(match[1]) : 0;
}

export function bestVersionForDevice(versions: FileVersion[], preferredFileId?: number): FileVersion | undefined {
  if (preferredFileId != null) {
    const last = versions.find(version => version.file_id === preferredFileId);
    if (last) return last;
  }
  // webOS reports a 1920x1080 CSS viewport even on many UHD televisions. A
  // real LG TV can negotiate a 2160p source; desktop development is bounded
  // by its physical screen to avoid needlessly selecting a larger edition.
  const isWebOs = /web0s|webos|netcast/i.test(navigator.userAgent);
  const physicalHeight = Math.round(screen.height * (window.devicePixelRatio || 1));
  const deviceLimit = isWebOs ? 2160 : physicalHeight >= 2160 ? 2160 : physicalHeight >= 1080 ? 1080 : 720;
  return [...versions].sort((left, right) => {
    const leftHeight = resolutionHeight(left.resolution);
    const rightHeight = resolutionHeight(right.resolution);
    const leftScore = leftHeight <= deviceLimit ? leftHeight : -leftHeight;
    const rightScore = rightHeight <= deviceLimit ? rightHeight : -rightHeight;
    return rightScore - leftScore || (right.bitrate ?? 0) - (left.bitrate ?? 0);
  })[0];
}

function requirePlan(decision: Decision): PlaybackPlan {
  if (decision.outcome !== "playable" || !decision.playback_plan) throw new Error(decision.terminal?.message ?? decision.terminal?.reason ?? "Silo could not create a playback plan.");
  return decision.playback_plan;
}

export async function getWatchDetail(session: Session, item: SiloItem): Promise<WatchDetail> {
  const detail = await requestV2<WatchDetail>(session, `/watch/${encodeURIComponent(item.Id)}`);
  return { ...detail, versions: (detail.versions ?? []).map(version => ({ ...version, duration: version.duration_seconds ?? version.duration })) };
}

export type TrickplaySheet = { index: number; url: string };
export type Trickplay = { file_id: string; interval_ms: number; thumbnail_count: number; thumbnail_width: number; thumbnail_height: number; tile_columns: number; tile_rows: number; sheets: TrickplaySheet[]; expires_at: string };
export type MarkerSegment = { start_seconds: number; end_seconds: number; provider?: string; source?: string; confidence?: number; algorithm?: string; detected_at?: string };
export type MarkerOccurrence = { kind: string; start_seconds: number; end_seconds: number; thumbnail_url?: string; thumbnail_thumbhash?: string; thumbnail_capture_seconds?: number };
export type FileMarkers = { file_id: string; intro: MarkerSegment | null; credits: MarkerSegment | null; recap: MarkerSegment | null; preview: MarkerSegment | null; marker_segments: MarkerOccurrence[] };

async function optionalSiloJson<T>(session: Session, path: string): Promise<T | null> {
  try {
    return await requestV2<T>(session, path);
  } catch (reason) {
    if (reason instanceof Error && /: 404[ :]/.test(reason.message)) return null;
    throw reason;
  }
}

export function getTrickplay(session: Session, itemId: string, fileId?: number): Promise<Trickplay | null> {
  return optionalSiloJson(session, `/watch/${encodeURIComponent(itemId)}/trickplay${fileId ? `?file_id=${encodeURIComponent(String(fileId))}` : ""}`);
}

export function getMarkers(session: Session, itemId: string): Promise<FileMarkers | null> {
  return optionalSiloJson(session, `/markers/items/${encodeURIComponent(itemId)}`);
}

export async function startPlaybackV3(session: Session, detail: WatchDetail, version: FileVersion, quality = "auto", audioIndex?: number, subtitleIndex?: number, startPosition?: number) {
  if (!session.profileId) throw new Error("A Silo profile is required for playback.");
  const playbackAttemptId = uuid("webos");
  const body = { installation_id: await playbackInstallationId(session), protocol_version: 3, client_features: features, file_id: version.file_id, profile_id: session.profileId, playback_attempt_id: playbackAttemptId, quality_preference: quality, subtitle_fidelity_preference: "compatible", start_position: startPosition ?? detail.user_data?.position_seconds ?? 0, ...(audioIndex == null ? {} : { audio_track_id: `file:${version.file_id}:audio:${audioIndex}`, audio_track_index: audioIndex }), ...(subtitleIndex == null ? {} : subtitleIndex < 0 ? { subtitle_track_index: -1 } : { subtitle_track_id: `file:${version.file_id}:subtitle:${subtitleIndex}`, subtitle_track_index: subtitleIndex }), metered: false, ...snapshot() };
  const decision = await requestV2<Decision>(session, "/playback/start", { method: "POST", body: JSON.stringify(body) });
  return { plan: requirePlan(decision), playbackAttemptId, planAttemptId: uuid("plan") };
}

export async function replanPlaybackV3(session: Session, state: { plan: PlaybackPlan; playbackAttemptId: string; planAttemptId: string; attemptedKeys: string[] }, operation: "track_change" | "quality_change" | "seek_reanchor", position: number, quality: string, selected: { audio?: TrackIdentity; subtitle?: TrackIdentity }) {
  const attemptedKeys = [state.plan.plan_attempt_key];
  const body = { installation_id: await playbackInstallationId(session), protocol_version: 3, client_features: features, operation, playback_attempt_id: state.playbackAttemptId, replan_request_id: uuid("replan"), failed_plan_id: state.plan.plan_id, plan_attempt_id: state.planAttemptId, plan_attempt_key: state.plan.plan_attempt_key, attempted_plan_keys: attemptedKeys, attempt_count: attemptedKeys.length, quality_preference: quality, position_seconds: position, metered: false, selected_tracks: selected, local_mutations: [], ...snapshot() };
  const decision = await requestV2<Decision>(session, `/playback/${encodeURIComponent(state.plan.session_id)}/replan`, { method: "POST", body: JSON.stringify(body) });
  return { plan: requirePlan(decision), playbackAttemptId: state.playbackAttemptId, planAttemptId: uuid("plan"), attemptedKeys: [] };
}

const progressSequences = new Map<string, number>();
function nextSequence(id: string) {
  const sequence = (progressSequences.get(id) ?? 0) + 1;
  progressSequences.set(id, sequence);
  return sequence;
}
const stopBody = (session: Session) => JSON.stringify({ installation_id: cachedInstallationId(session), stop_id: randomUuid() });

export const reportProgress = async (session: Session, id: string, position: number, paused: boolean) => requestV2<unknown>(session, `/playback/${encodeURIComponent(id)}/progress`, { method: "POST", body: JSON.stringify({ installation_id: await playbackInstallationId(session), sequence: nextSequence(id), position, is_paused: paused }) });
export const stopPlayback = async (session: Session, id: string) => requestV2<unknown>(session, `/playback/${encodeURIComponent(id)}`, { method: "DELETE", body: stopBody(session) });

export function stopPlaybackKeepalive(session: Session, id: string): Promise<Response> {
  const root = session.serverUrl.replace(/\/+$/, "");
  return fetch(`${root}/api/v2/playback/${encodeURIComponent(id)}`, {
    method: "DELETE",
    keepalive: true,
    body: stopBody(session),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
      ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {})
    }
  });
}

export function playbackUrl(session: Session, url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  const root = session.serverUrl.replace(/\/+$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return path.startsWith("/api/") ? `${root}${path}` : `${root}/api/v2${path}`;
}

function serverLanguageTag(language?: string) {
  const key = language?.trim().toLowerCase();
  return !key || key === "und" || key === "undetermined" ? "" : key;
}

export function saveAudioChoice(session: Session, seriesId: string, track: AudioTrack, ordinal: number) {
  return requestV2<void>(session, `/audio-prefs/${encodeURIComponent(seriesId)}`, { method: "PUT", body: JSON.stringify({ audio_track_index: Math.max(0, ordinal), audio_language: serverLanguageTag(track.language), track_signature: { language: serverLanguageTag(track.language) || null, title: track.title?.trim() || null, embedded_title: track.embedded_title?.trim() || null, codec: track.codec?.trim() || null, layout: track.layout?.trim() || null, channels: track.channels && track.channels > 0 ? track.channels : null } }) });
}

export function saveSubtitleChoice(session: Session, seriesId: string, track: SubtitleTrack | undefined, index: number) {
  return requestV2<void>(session, `/subtitle-prefs/${encodeURIComponent(seriesId)}`, { method: "PUT", body: JSON.stringify({ subtitle_language: track ? serverLanguageTag(track.language) : "", subtitle_track_index: track ? Math.max(0, index) : -1, external_subtitle_path: "", subtitle_mode: track ? "always" : "off", track_signature: track ? { source: track.source ?? (track.external ? "external" : "embedded"), language: serverLanguageTag(track.language) || null, codec: track.codec?.trim() || null, label: track.title?.trim() || null, forced: track.forced ?? false, hearing_impaired: track.hearing_impaired ?? false } : null }) });
}

export function saveAudioPreference(session: Session, seriesId: string, track: AudioTrack) {
  return requestV2<void>(session, `/audio-prefs/${encodeURIComponent(seriesId)}`, { method: "PUT", body: JSON.stringify({ audio_track_index: track.index ?? -1, audio_language: track.language ?? "", track_signature: { language: track.language, title: track.title, embedded_title: track.embedded_title, codec: track.codec, layout: track.layout, channels: track.channels, default: track.default ?? false } }) });
}
export function saveSubtitlePreference(session: Session, seriesId: string, track?: SubtitleInventory) {
  return requestV2<void>(session, `/subtitle-prefs/${encodeURIComponent(seriesId)}`, { method: "PUT", body: JSON.stringify({ subtitle_language: track?.language ?? "", subtitle_track_index: track?.combined_index ?? -1, external_subtitle_path: "", subtitle_mode: track ? "always" : "off", track_signature: track ? { source: track.source, language: track.language, codec: track.codec, label: track.label, forced: track.forced, hearing_impaired: track.hearing_impaired } : null, show_forced_subtitles: false }) });
}
