import { deviceCaptioningAppearance, getSubtitleMatchesDevice } from "../platform/captions";
import { interruptThemeMusic } from "../core/themeMusic";
import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { pinFocusedRailItem } from "../navigation/spatial";
import { bestVersionForDevice, getMarkers, getTrickplay, getWatchDetail, playbackUrl, replanPlaybackV3, reportProgress, saveAudioPreference, saveSubtitlePreference, startPlaybackV3, stopPlayback, stopPlaybackKeepalive, type AudioTrack, type FileMarkers, type MarkerSegment, type PlaybackChoices, type PlaybackPlan, type Quality, type SubtitleInventory, type Trickplay, type WatchDetail } from "../api/playback";
import type { Session, SiloItem } from "../types";
import { getEffectiveSettings, putScopedSetting } from "../api/settings";
import { artUrl, getHomeRails, getShuffle, skipShuffle } from "../api/silo";
import { parseSubtitleAppearance, SUBTITLE_APPEARANCE_CHOICES, SUBTITLE_APPEARANCE_FIELDS, subtitleChoiceLabel, subtitleCueCss } from "../core/subtitleStyle";
import { putDeviceSubtitleAppearance, putProfileSubtitleAppearance, type SubtitleAppearance } from "../api/settings";
import { applySubtitleDelay, attachSidecarSubtitle, sidecarSubtitleArtifact } from "../core/subtitleSidecar";
import { audioDelaySupported, setAudioDelay } from "../platform/audioDelay";
import { SubtitleSearchDialog } from "../components/SubtitleSearchDialog";
import { languageSearchCode } from "../core/languageNames";
import { AiTranslateDialog, type AiSource } from "../components/AiTranslateDialog";
import { createAiTranslateStore, type AiTranslateStore } from "../core/aiTranslateJob";
import { getAiStatus, type AiStatus } from "../api/subtitles";
import { createSubtitleSyncStore, delaySecondsLabel, FORBIDDEN_MESSAGE, timingActionsFor, timingValue, type SubtitleSyncStore, type SyncUiState } from "../core/subtitleSync";
import { delayLabel, localAudioSyncMs, localDolbyVisionEnabled, localHdrEnabled, localPassOutThreshold, localResumeRewindSeconds, localSubtitleSyncMs, markerAction, resumePositionWithRewind, setLocalAudioSyncMs, setLocalDolbyVisionEnabled, setLocalHdrEnabled, setLocalSubtitleSyncMs } from "../core/playerSettings";

type PlaybackState = { plan: PlaybackPlan; playbackAttemptId: string; planAttemptId: string; attemptedKeys: string[] };
const ACTIVE_PLAYBACK_KEY = "silo-webos-active-playback-v1";

// Seek grammar mirrors the Android TV player exactly (TvSeekRateLadder):
// a signed 1x..32x ladder, a 100 ms tick carrying 2.0s of content per tick
// per rate unit, and a hidden-controls hold that ramps 1 -> 2 -> 4 -> 8.
const TICK_MS = 100;
const SECONDS_PER_TICK_AT_1X = 2.0;
const RATES = [1, 2, 4, 8, 16, 32];
const RAMP_RATES = [2, 4, 8];
const RAMP_STEP_MS = 1200;
const DEFAULT_SKIP_BACK_SECONDS = 10;
const DEFAULT_SKIP_FORWARD_SECONDS = 30;
const SKIP_CHOICES = [5, 10, 15, 30, 45, 60, 90];
const validSkip = (value: unknown, fallback: number) => typeof value === "number" && SKIP_CHOICES.includes(value) ? value : fallback;
const CONTROLS_AUTO_HIDE_MS = 5000;
const SKIP_FEEDBACK_HIDE_MS = 1200;
const CLEAN_SEEK_HOLD_THRESHOLD_MS = 300;
const NEXT_UP_COUNTDOWN_SECONDS = 10;
const INTRO_PROMPT_SECONDS = 5;
// Marker band colors mirror TvPlayerScrubber's track bands.
const BAND_COLORS: Record<string, string> = { intro: "#22D3EE", recap: "#8BC34A", credits: "#FFB74D", preview: "#BA68C8" };

function elapsedSeekSeconds(rate: number, elapsedMs: number) {
  return rate * SECONDS_PER_TICK_AT_1X * Math.max(0, elapsedMs) / TICK_MS;
}

/** Step `delta` along the signed ladder ...-32, ..., -1, 1, ..., 32; stepping past 1x reverses. */
function bumpedRate(current: number, delta: number) {
  const signed = [...RATES].reverse().map(rate => -rate).concat(RATES);
  const index = signed.indexOf(current);
  if (index < 0) return current;
  return signed[Math.max(0, Math.min(signed.length - 1, index + delta))];
}

function clampSeek(seconds: number, duration: number) {
  return Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER / 1000, seconds));
}

/** The trickplay tile for [seconds] — the last thumbnail past the end, like TrickplayManifest.tileAt. */
function trickplayTileAt(trickplay: Trickplay, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const position = seconds * 1000 / trickplay.interval_ms;
  const index = position >= trickplay.thumbnail_count - 1 ? trickplay.thumbnail_count - 1 : Math.floor(position);
  const perSheet = trickplay.tile_columns * trickplay.tile_rows;
  const cell = index % perSheet;
  return {
    sheet: Math.floor(index / perSheet),
    x: (cell % trickplay.tile_columns) * trickplay.thumbnail_width,
    y: Math.floor(cell / trickplay.tile_columns) * trickplay.thumbnail_height,
    width: trickplay.thumbnail_width,
    height: trickplay.thumbnail_height
  };
}

const languageNames: Record<string, string> = {
  en: "English", eng: "English", nl: "Dutch", nld: "Dutch", dut: "Dutch",
  de: "German", deu: "German", ger: "German", fr: "French", fra: "French", fre: "French",
  es: "Spanish", spa: "Spanish", it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese",
  ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean", zh: "Chinese", zho: "Chinese", chi: "Chinese"
};

function subtitleName(track: SubtitleInventory) {
  const code = track.language?.trim().toLowerCase();
  const language = code ? languageNames[code] ?? track.language!.toUpperCase() : undefined;
  const genericLabel = track.label?.trim();
  const codecLike = genericLabel && track.codec && genericLabel.toLowerCase().replace(/[_ -]/g, "") === track.codec.toLowerCase().replace(/[_ -]/g, "");
  return language ?? (!codecLike ? genericLabel : undefined) ?? "Unknown language";
}

function subtitleDetail(track: SubtitleInventory) {
  return [track.codec?.toUpperCase(), track.hearing_impaired ? "SDH" : undefined, track.forced ? "Forced" : undefined]
    .filter(Boolean).join(" · ");
}

function clientDiagnostic(event: string, details: Record<string, unknown>) {
  console.error(`[Silo webOS] ${event}`, details);
  if (import.meta.env.DEV) {
    void fetch("/__client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at: new Date().toISOString(), event, ...details })
    }).catch(() => undefined);
  }
}

function versionLabel(file: PlayerFileVersion) {
  return [file.edition_raw, file.resolution, file.codec_video?.toUpperCase(), file.codec_audio?.toUpperCase()].filter(Boolean).join(" · ") || `File ${file.file_id}`;
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

type HudTab = "Info" | "Stats" | "Video" | "Audio" | "Subtitles" | "Chapters";
type PlayerFileVersion = WatchDetail["versions"][number];
type PillKind = "intro" | "credits" | "recap";
type Pill = { kind: PillKind; key: string; label: string; secondsRemaining: number | null; undo?: boolean };
type UiSnapshot = { upNextOpen: boolean; hud: boolean; panel: "audio" | "subtitles" | "quality" | null; hudTab: HudTab; audioAvailable: boolean; subtitlesAvailable: boolean; scrubPreview: number | null; autoSeekRate: number; cleanSeek: { rate: number; preview: number } | null; pill: Pill | null; position: number; duration: number; playing: boolean };

/** The player's transport glyphs: dark-disc buttons inverting to Paper on focus. */
function TransportGlyph({ name, seconds = 0 }: { name: "play" | "pause" | "back10" | "forward30" | "subtitles" | "tune" | "close" | "upNext"; seconds?: number }) {
  const arc = (forward: boolean, seconds: number) => <g>
    <path d={forward ? "M12 4a8 8 0 1 1-7.4 4.9" : "M12 4a8 8 0 1 0 7.4 4.9"} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    <path d={forward ? "M3.2 6.4 4.9 9.2 7.8 7.9" : "M20.8 6.4 19.1 9.2 16.2 7.9"} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    <text x="12" y="15.6" textAnchor="middle" fontSize="7.6" fontWeight="700" fill="currentColor" stroke="none" fontFamily="inherit">{seconds}</text>
  </g>;
  switch (name) {
    case "play": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 5.6v12.8c0 .9 1 1.4 1.7.9l9-6.4c.6-.4.6-1.4 0-1.8l-9-6.4c-.7-.5-1.7 0-1.7.9z" fill="currentColor" /></svg>;
    case "pause": return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.4" y="5" width="3.9" height="14" rx="1.3" fill="currentColor" /><rect x="13.7" y="5" width="3.9" height="14" rx="1.3" fill="currentColor" /></svg>;
    case "back10": return <svg viewBox="0 0 24 24" aria-hidden="true">{arc(false, seconds)}</svg>;
    case "forward30": return <svg viewBox="0 0 24 24" aria-hidden="true">{arc(true, seconds)}</svg>;
    case "subtitles": return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.4" y="4.8" width="17.2" height="14.4" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M6.6 14.6h6.2M15.2 14.6h2.4M6.6 10.4h2.2M11 10.4h6.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
    case "tune": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h9m4 0h3M4 16h3m4 0h9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><circle cx="15" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.9" /><circle cx="9" cy="16" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>;
    case "close": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg>;
    case "upNext": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14l11-7L4 5zm13 0v14h3V5h-3z" fill="currentColor" /></svg>;
  }
}

type LgMediaKey = "play" | "pause" | "playpause" | "stop" | "rewind" | "forward";

function lgMediaKey(event: KeyboardEvent): LgMediaKey | undefined {
  switch (event.key) {
    case "MediaPlay": return "play";
    case "MediaPause": return "pause";
    case "MediaPlayPause": return "playpause";
    case "MediaStop": return "stop";
    case "MediaRewind":
    case "MediaTrackPrevious": return "rewind";
    case "MediaFastForward":
    case "MediaTrackNext": return "forward";
  }
  switch (event.keyCode) {
    case 415: return "play";
    case 19: return "pause";
    case 10252: return "playpause";
    case 413: return "stop";
    case 412: return "rewind";
    case 417: return "forward";
  }
  return undefined;
}

export function PlayerScreen({ session, item, startPosition, choices, onBack, onEnded, resolveNextEpisode, onPlayNext, shuffle, onShuffleAdvance, autoAdvanceCount = 0 }: { session: Session; item: SiloItem; startPosition?: number; choices?: PlaybackChoices; onBack: (elapsedSeconds: number) => void; onEnded?: () => void; resolveNextEpisode?: () => Promise<SiloItem | null>; onPlayNext?: (next: SiloItem, autoAdvanceCount: number) => void; shuffle?: { id: string; scopeLabel?: string; next?: SiloItem }; onShuffleAdvance?: (autoAdvanceCount: number) => void; autoAdvanceCount?: number }) {
  useEffect(() => { interruptThemeMusic(); }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const sidecarTrack = useRef<TextTrack | null>(null);
  const closedSessions = useRef(new Set<string>());
  const endedHandled = useRef(false);
  const stateRef = useRef<PlaybackState | undefined>(undefined);
  const qualityRef = useRef("auto");
  const [detail, setDetail] = useState<WatchDetail>();
  const [version, setVersion] = useState<WatchDetail["versions"][number]>();
  const [plan, setPlan] = useState<PlaybackPlan>();
  const [hud, setHud] = useState(true);
  const [panel, setPanel] = useState<"audio" | "subtitles" | "quality" | null>(null);
  const [hudPicker, setHudPicker] = useState<{ title: string; choices: Array<{ label: string; value: string }>; selected: string; returnKey: string; onSelect: (value: string) => void } | null>(null);
  const hudPickerRef = useRef(hudPicker);
  hudPickerRef.current = hudPicker;
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [aspectMode, setAspectMode] = useState<"Fit" | "Zoom" | "Stretch">("Fit");
  const aspectLabel = (mode: "Fit" | "Zoom" | "Stretch") => mode === "Fit" ? "Letterbox" : mode === "Zoom" ? "Zoom (crop)" : "Stretch";
  const [sleepDeadline, setSleepDeadline] = useState<number | null>(null);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
  const [playerStats, setPlayerStats] = useState<{ totalFrames?: number; droppedFrames?: number; resolution?: string }>({});
  const [hudTab, setHudTab] = useState<HudTab>("Video");
  const hudTabsRef = useRef<HudTab[]>(["Info", "Video", "Subtitles"]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);
  const [bufferedAhead, setBufferedAhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = playbackSpeed; }, [playbackSpeed]);
  useEffect(() => {
    if (sleepDeadline == null) { setSleepRemaining(null); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 1000));
      setSleepRemaining(remaining);
      if (remaining === 0) {
        videoRef.current?.pause();
        setSleepDeadline(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [sleepDeadline]);

  useEffect(() => {
    const read = () => {
      const video = videoRef.current as (HTMLVideoElement & { webkitDecodedFrameCount?: number; webkitDroppedFrameCount?: number }) | null;
      if (!video) return;
      const quality = video.getVideoPlaybackQuality?.();
      const totalFrames = quality?.totalVideoFrames ?? video.webkitDecodedFrameCount;
      const droppedFrames = quality?.droppedVideoFrames ?? video.webkitDroppedFrameCount;
      setPlayerStats({
        totalFrames: typeof totalFrames === "number" ? totalFrames : undefined,
        droppedFrames: typeof droppedFrames === "number" ? droppedFrames : undefined,
        resolution: video.videoWidth && video.videoHeight ? `${video.videoWidth} × ${video.videoHeight}` : undefined
      });
    };
    read();
    const timer = window.setInterval(read, 1500);
    return () => window.clearInterval(timer);
  }, [plan?.plan_id]);

  // Focused-bar scrub state: preview target while a scrub is in flight, plus
  // the signed auto-seek rate a held Left/Right climbs to (tap to step).
  const [scrubPreview, setScrubPreview] = useState<number | null>(null);
  const [tapPreview, setTapPreview] = useState<number | null>(null);
  const tapPreviewTimer = useRef<number | undefined>(undefined);
  const [autoSeekRate, setAutoSeekRate] = useState(0);
  const [scrubberFocused, setScrubberFocused] = useState(false);
  // Hidden-controls hold-to-seek session: rate + preview while the viewer
  // holds Left/Right from clean playback (ramps 1 -> 2 -> 4 -> 8).
  const [cleanSeek, setCleanSeek] = useState<{ rate: number; preview: number } | null>(null);
  // Transient chip after a quick skip: what it did, where it landed.
  const [skipFeedback, setSkipFeedback] = useState<{ delta: number; target: number; nonce: number } | null>(null);
  const [pill, setPill] = useState<Pill | null>(null);

  const hideTimer = useRef<number | undefined>(undefined);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const autoSeekLoop = useRef<number | undefined>(undefined);
  const cleanSeekLoop = useRef<number | undefined>(undefined);
  const cleanSeekRamp = useRef<number | undefined>(undefined);
  const cleanSeekHold = useRef<number | undefined>(undefined);
  const pendingTapDirection = useRef(0);
  const pendingCleanPress = useRef<{ direction: number; generation: number; becameHold: boolean } | null>(null);
  const resolvedMarkers = useRef(new Set<string>());
  const autoSkippedMarkers = useRef(new Set<string>());
  const expiredMarkerKey = useRef<string | null>(null);
  const trickplayReadAt = useRef(0);
  const nonceRef = useRef(0);
  const [trickplay, setTrickplay] = useState<Trickplay | null>(null);
  const [markers, setMarkers] = useState<FileMarkers | null>(null);
  const [introSkipMode, setIntroSkipMode] = useState<"never" | "ask" | "always">("ask");
  const [autoSkipCredits, setAutoSkipCredits] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [upNext, setUpNext] = useState<SiloItem | null>(null);
  const [upNextCard, setUpNextCard] = useState<{ videoEnded: boolean } | null>(null);
  const [upNextCountdown, setUpNextCountdown] = useState<{ seconds: number; total: number } | null>(null);
  const [shuffleScope, setShuffleScope] = useState(shuffle?.scopeLabel);
  const [shufflePicking, setShufflePicking] = useState(false);
  const [shuffleMessage, setShuffleMessage] = useState<string | null>(null);
  const shuffleMessageTimer = useRef<number | undefined>(undefined);
  const upNextPane = useRef<HTMLDivElement>(null);
  const [upNextRect, setUpNextRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [skipSeconds, setSkipSeconds] = useState({ back: DEFAULT_SKIP_BACK_SECONDS, forward: DEFAULT_SKIP_FORWARD_SECONDS });
  const skipRef = useRef(skipSeconds);
  skipRef.current = skipSeconds;
  const [subtitleCss, setSubtitleCss] = useState("");
  const [appearance, setAppearance] = useState<SubtitleAppearance | null>(null);
  const [appearanceDeviceOnly, setAppearanceDeviceOnly] = useState(false);
  const [audioDelayMs, setAudioDelayMs] = useState(localAudioSyncMs);
  const [subtitleDelayMs, setSubtitleDelayMs] = useState(localSubtitleSyncMs);
  const [hdrOn, setHdrOn] = useState(localHdrEnabled);
  const [dolbyOn, setDolbyOn] = useState(localDolbyVisionEnabled);
  const [dolbyApplying, setDolbyApplying] = useState(false);
  const subtitleDelayRef = useRef(subtitleDelayMs);
  subtitleDelayRef.current = subtitleDelayMs;
  const [subtitleSearch, setSubtitleSearch] = useState<{ language: string } | null>(null);
  const [aiDialog, setAiDialog] = useState<{ language: string } | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const aiStatusRequested = useRef(false);
  const emptySync: SyncUiState = { available: false, externalAvailable: false, entries: {} };
  const [syncUi, setSyncUi] = useState<SyncUiState>(emptySync);
  const syncStore = useRef<SubtitleSyncStore | null>(null);
  const reloadSidecarRef = useRef<(key: string) => void>(() => undefined);
  const aiStore = useRef<{ fileId: number; store: AiTranslateStore } | null>(null);
  const refreshAfterDownloadRef = useRef<() => Promise<boolean>>(async () => false);
  const aiPositionRef = useRef<() => number>(() => 0);
  const [styleView, setStyleView] = useState<null | "list" | "timing" | keyof SubtitleAppearance>(null);
  const styleViewRef = useRef(styleView);
  styleViewRef.current = styleView;
  useEffect(() => {
    const video = videoRef.current;
    if (video) setAudioDelay(video, audioDelayMs);
  }, [audioDelayMs, plan?.session_id]);
  useEffect(() => { if (!panel || hudTab !== "Subtitles") setStyleView(null); }, [panel, hudTab]);
  const [onDeckItems, setOnDeckItems] = useState<SiloItem[]>([]);
  const [hideUnwatchedOverview, setHideUnwatchedOverview] = useState(false);
  const [hideUnwatchedImages, setHideUnwatchedImages] = useState(false);
  const hidesArt = (candidate: SiloItem) => hideUnwatchedImages && candidate.UserData?.Played !== true && (candidate.UserData?.PlaybackPositionTicks ?? 0) <= 0;
  const nextUpBackdrop = (upNext && !hidesArt(upNext) ? artUrl(session, upNext) : "") || onDeckItems.map(candidate => hidesArt(candidate) ? "" : artUrl(session, candidate)).find(Boolean) || "";
  const upNextHandled = useRef(false);
  const upNextPendingEnd = useRef<boolean | null>(null);
  const upNextStartedAtEnd = useRef(false);
  const upNextWall = useRef(NEXT_UP_COUNTDOWN_SECONDS);
  const previousPosition = useRef(0);
  const [playerSettingsLoaded, setPlayerSettingsLoaded] = useState(false);

  const scrubberRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const transportRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  // The key handler binds once and reads this snapshot, so it always sees the
  // current render's values.
  const ui = useRef<UiSnapshot>({ upNextOpen: false, hud: true, panel: null, hudTab: "Video", audioAvailable: false, subtitlesAvailable: false, scrubPreview: null, autoSeekRate: 0, cleanSeek: null, pill: null, position: 0, duration: 0, playing: false });
  ui.current = { upNextOpen: upNextCard != null, hud, panel, hudTab, audioAvailable: Boolean(version?.audio_tracks?.length), subtitlesAvailable: Boolean(plan?.subtitle.inventory.length), scrubPreview, autoSeekRate, cleanSeek, pill, position, duration, playing };

  const pendingSeekTarget = useRef<number | null>(null);
  const pendingSeekTimer = useRef<number | undefined>(undefined);
  const seekGeneration = useRef(0);
  const clearPendingSeek = useCallback(() => {
    pendingSeekTarget.current = null;
    if (pendingSeekTimer.current) window.clearTimeout(pendingSeekTimer.current);
    pendingSeekTimer.current = undefined;
  }, []);

  const releaseReachedSeek = useCallback((video: HTMLVideoElement) => {
    const pending = pendingSeekTarget.current;
    if (pending == null || video.seeking) return;
    const offset = stateRef.current?.plan.timeline.timeline_offset_seconds ?? 0;
    if (video.currentTime + offset >= pending - 0.5) clearPendingSeek();
  }, [clearPendingSeek]);

  const sourcePosition = useCallback(() => {
    if (pendingSeekTarget.current != null) return pendingSeekTarget.current;
    const video = videoRef.current;
    const active = stateRef.current?.plan;
    return Math.max(0, (video?.currentTime ?? 0) + (active?.timeline.timeline_offset_seconds ?? 0));
  }, []);

  const installPlan = useCallback((next: PlaybackState) => {
    stateRef.current = next;
    localStorage.setItem(ACTIVE_PLAYBACK_KEY, JSON.stringify({ sessionId: next.plan.session_id, serverUrl: session.serverUrl, profileId: session.profileId }));
    setPlan(next.plan);
    const video = videoRef.current;
    if (!video) return;
    const streamUrl = playbackUrl(session, next.plan.stream.url);
    const sidecarHeaders = {
      Authorization: `Bearer ${session.accessToken}`,
      ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
      ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {}),
      ...(next.plan.stream.headers ?? {})
    };
    void attachSidecarSubtitle(video, next.plan, session, sidecarHeaders, sidecarTrack.current, subtitleDelayRef.current).then(track => { sidecarTrack.current = track; }).catch(() => undefined);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    console.info("[Silo webOS] installing playback-v3 plan", {
      delivery: next.plan.delivery,
      protocol: next.plan.stream.protocol,
      container: next.plan.stream.container,
      mimeType: next.plan.stream.mime_type,
      planId: next.plan.plan_id,
      streamUrl
    });
    clientDiagnostic("installing playback-v3 plan", {
      delivery: next.plan.delivery,
      protocol: next.plan.stream.protocol,
      container: next.plan.stream.container,
      mimeType: next.plan.stream.mime_type,
      planId: next.plan.plan_id,
      streamUrl,
      streamHeaders: Object.keys(next.plan.stream.headers ?? {})
    });
    const begin = () => {
      if (next.plan.timeline.player_start_seconds > 0) video.currentTime = next.plan.timeline.player_start_seconds;
      void video.play().catch(() => setHud(true));
    };
    const isHls = next.plan.stream.protocol.toLowerCase() === "hls" || /mpegurl/i.test(next.plan.stream.mime_type ?? "") || /\.m3u8(?:\?|$)/i.test(streamUrl);
    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    if (isHls) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${session.accessToken}`,
        ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
        ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {}),
        ...(next.plan.stream.headers ?? {})
      };
      void import("hls.js").then(({ default: HlsPlayer }) => {
        if (stateRef.current?.plan.plan_id !== next.plan.plan_id) return;
        if (!HlsPlayer.isSupported()) {
          if (!nativeHls) { setError("This browser cannot play the negotiated HLS stream."); return; }
          video.src = streamUrl;
          video.load();
          video.onloadedmetadata = begin;
          return;
        }
        const hls = new HlsPlayer({
          enableWorker: true,
          xhrSetup: (xhr) => Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value))
        });
        hlsRef.current = hls;
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, begin);
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          clientDiagnostic("HLS playback error", { fatal: data.fatal, type: data.type, details: data.details, reason: data.reason, responseCode: data.response?.code, responseUrl: data.response?.url });
          if (data.fatal) setError(`HLS playback error: ${data.details}`);
        });
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          const rendition = next.plan.subtitle.hls_rendition;
          if (rendition) {
            const tracks = hls.subtitleTracks ?? [];
            const index = tracks.findIndex(track => track.name === rendition.name);
            if (index >= 0) hls.subtitleTrack = index;
          }
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
      }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load HLS playback support."));
    } else {
      video.src = streamUrl;
      video.load();
      video.onloadedmetadata = begin;
    }
  }, [session]);

  const closePlayback = useCallback((keepalive = false) => {
    const active = stateRef.current;
    if (!active || closedSessions.current.has(active.plan.session_id)) return;
    closedSessions.current.add(active.plan.session_id);
    localStorage.removeItem(ACTIVE_PLAYBACK_KEY);
    const video = videoRef.current;
    const currentPosition = sourcePosition();
    if (keepalive) {
      void stopPlaybackKeepalive(session, active.plan.session_id).catch(() => undefined);
    } else {
      void reportProgress(session, active.plan.session_id, currentPosition, true)
        .catch(() => undefined)
        .finally(() => stopPlayback(session, active.plan.session_id).catch(() => undefined));
    }
    video?.pause();
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, [session, sourcePosition]);

  useEffect(() => {
    if (!upNextCard) { setUpNextRect(null); return; }
    const measure = () => {
      const rect = upNextPane.current?.getBoundingClientRect();
      if (rect && rect.width > 0) setUpNextRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [upNextCard != null]);

  const advanceToNext = useCallback((nextCount: number) => {
    if (!upNext) return;
    setUpNextCountdown(null);
    closePlayback(false);
    if (shuffle) onShuffleAdvance?.(nextCount);
    else onPlayNext?.(upNext, nextCount);
  }, [upNext, closePlayback, onPlayNext, onShuffleAdvance, shuffle != null]);

  const commitApproachingEnd = useCallback((videoEnded: boolean) => {
    upNextHandled.current = true;
    upNextPendingEnd.current = null;
    const threshold = localPassOutThreshold();
    const gated = threshold > 0 && autoAdvanceCount >= threshold;
    const counting = autoPlayNext && !gated;
    const initial = !counting ? null : videoEnded ? NEXT_UP_COUNTDOWN_SECONDS : Math.ceil(Math.max(0, ui.current.duration - ui.current.position));
    upNextStartedAtEnd.current = videoEnded;
    upNextWall.current = NEXT_UP_COUNTDOWN_SECONDS;
    setUpNextCard({ videoEnded });
    setUpNextCountdown(initial == null ? null : { seconds: initial, total: Math.max(initial, 1) });
    setHud(false);
  }, [autoAdvanceCount, autoPlayNext]);

  const onApproachingEnd = useCallback((videoEnded: boolean) => {
    if (upNextHandled.current) {
      if (videoEnded) { setUpNextCard({ videoEnded: true }); setHud(false); }
      return;
    }
    if (!upNext) {
      const ended = videoEnded || upNextPendingEnd.current === true;
      upNextPendingEnd.current = ended;
      if (ended) { setUpNextCard({ videoEnded: true }); setUpNextCountdown(null); setHud(false); }
      return;
    }
    commitApproachingEnd(videoEnded);
  }, [upNext, commitApproachingEnd]);

  const handleMediaEnded = useCallback(() => {
    if (shuffle || (resolveNextEpisode && item.Type === "Episode")) {
      onApproachingEnd(true);
      return;
    }
    closePlayback(false);
    onEnded?.();
  }, [resolveNextEpisode, item.Type, onApproachingEnd, closePlayback, onEnded]);

  const keepWatching = useCallback(() => {
    upNextHandled.current = true;
    setUpNextCountdown(null);
    setUpNextCard(null);
  }, []);

  const toggleAutoPlayNext = useCallback(() => {
    const next = !autoPlayNext;
    setAutoPlayNext(next);
    if (!next) setUpNextCountdown(null);
    void putScopedSetting(session, "playback.auto_play_next", "profile_device", next).catch(() => undefined);
  }, [autoPlayNext, session]);

  useEffect(() => {
    if (item.Type !== "Episode") { setOnDeckItems([]); return; }
    let alive = true;
    void getHomeRails(session).then(rails => {
      if (!alive) return;
      const currentSeries = item.SeriesId;
      const items = rails.filter(rail => /continue|in.progress|next.up/i.test(rail.id + " " + rail.title))
        .flatMap(rail => rail.items)
        .filter(candidate => candidate.Id !== item.Id && (!currentSeries || candidate.SeriesId !== currentSeries) && Boolean(candidate.BackdropUrl || candidate.PosterUrl))
        .filter((candidate, index, all) => all.findIndex(other => other.Id === candidate.Id) === index)
        .slice(0, 12);
      setOnDeckItems(items);
    }).catch(() => { if (alive) setOnDeckItems([]); });
    return () => { alive = false; };
  }, [item.Id, session]);

  const showShuffleMessage = useCallback((message: string) => {
    window.clearTimeout(shuffleMessageTimer.current);
    setShuffleMessage(message);
    shuffleMessageTimer.current = window.setTimeout(() => setShuffleMessage(null), 4000);
  }, []);

  useEffect(() => () => window.clearTimeout(shuffleMessageTimer.current), []);

  const applyShuffleNext = useCallback((next: SiloItem | undefined, scopeLabel?: string) => {
    if (scopeLabel) setShuffleScope(scopeLabel);
    setUpNext(next && next.Id !== item.Id ? next : null);
  }, [item.Id]);

  const pickAnotherShuffle = useCallback(() => {
    if (!shuffle || !upNext || shufflePicking) return;
    setShufflePicking(true);
    skipShuffle(session, shuffle.id, upNext.Id).then(result => {
      applyShuffleNext(result.next, result.scopeLabel);
      if (upNextStartedAtEnd.current) {
        upNextWall.current = NEXT_UP_COUNTDOWN_SECONDS;
        setUpNextCountdown(current => current ? { seconds: NEXT_UP_COUNTDOWN_SECONDS, total: NEXT_UP_COUNTDOWN_SECONDS } : current);
      }
    }).catch(error => {
      if (String(error).includes(": 409")) { setUpNext(null); setUpNextCountdown(null); }
      else showShuffleMessage("Couldn't pick another.");
    }).finally(() => setShufflePicking(false));
  }, [shuffle, upNext, shufflePicking, session, applyShuffleNext, showShuffleMessage]);

  useEffect(() => {
    if (!shuffle) return;
    let alive = true;
    setUpNext(null);
    upNextHandled.current = false;
    upNextPendingEnd.current = null;
    applyShuffleNext(shuffle.next, shuffle.scopeLabel);
    getShuffle(session, shuffle.id).then(result => { if (alive) applyShuffleNext(result.next, result.scopeLabel); }).catch(() => undefined);
    return () => { alive = false; };
  }, [item.Id]);

  useEffect(() => {
    if (shuffle || !resolveNextEpisode || item.Type !== "Episode") return;
    let alive = true;
    setUpNext(null);
    upNextHandled.current = false;
    upNextPendingEnd.current = null;
    resolveNextEpisode().then(next => { if (alive) setUpNext(next); }).catch(() => undefined);
    return () => { alive = false; };
  }, [item.Id]);

  useEffect(() => {
    if (upNext && !upNextHandled.current && upNextPendingEnd.current != null) commitApproachingEnd(upNextPendingEnd.current);
  }, [upNext]);

  useEffect(() => {
    const before = previousPosition.current;
    previousPosition.current = position;
    const creditsStart = markers?.credits?.start_seconds;
    if (creditsStart == null || scrubPreview != null) return;
    if (before < creditsStart && position >= creditsStart && position - before < 5) onApproachingEnd(false);
  }, [position]);

  useEffect(() => {
    if (!upNextCard || !upNextCountdown || !upNext) return;
    const timer = window.setInterval(() => {
      const remaining = upNextStartedAtEnd.current
        ? Math.max(0, --upNextWall.current)
        : Math.ceil(Math.max(0, ui.current.duration - ui.current.position));
      setUpNextCountdown(current => current ? { seconds: remaining, total: Math.max(current.total, remaining, 1) } : current);
      const playbackEnded = upNextStartedAtEnd.current ? upNextWall.current <= 0 : upNextCard.videoEnded;
      if (playbackEnded) {
        window.clearInterval(timer);
        advanceToNext(autoAdvanceCount + 1);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [upNextCard?.videoEnded, upNextCountdown == null, upNext, autoAdvanceCount, advanceToNext]);

  useEffect(() => {
    try {
      const stale = JSON.parse(localStorage.getItem(ACTIVE_PLAYBACK_KEY) ?? "null") as { sessionId?: string; serverUrl?: string; profileId?: string } | null;
      if (stale?.sessionId && stale.serverUrl === session.serverUrl && stale.profileId === session.profileId) {
        void stopPlayback(session, stale.sessionId).catch(() => undefined).finally(() => {
          try {
            const current = JSON.parse(localStorage.getItem(ACTIVE_PLAYBACK_KEY) ?? "null") as { sessionId?: string } | null;
            if (current?.sessionId === stale.sessionId) localStorage.removeItem(ACTIVE_PLAYBACK_KEY);
          } catch { localStorage.removeItem(ACTIVE_PLAYBACK_KEY); }
        });
      }
    } catch { localStorage.removeItem(ACTIVE_PLAYBACK_KEY); }
  }, [session]);

  useEffect(() => {
    const unload = () => closePlayback(true);
    window.addEventListener("pagehide", unload);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("pagehide", unload);
      window.removeEventListener("beforeunload", unload);
    };
  }, [closePlayback]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setPlayerSettingsLoaded(false);
    setIntroSkipMode("ask");
    setAutoSkipCredits(false);
    setAutoPlayNext(true);
    Promise.all([
      getWatchDetail(session, item),
      getEffectiveSettings(session, ["playback.intro_skip_mode", "playback.auto_skip_credits", "playback.auto_play_next", "playback.subtitle_appearance", "catalog.hide_unwatched_episode_overviews", "catalog.hide_unwatched_episode_images", "player.video_skip_back_seconds", "player.video_skip_forward_seconds"]).catch(() => new Map()),
    ]).then(async ([watch, settings]) => {
      if (!alive) return;
      const configuredMode = settings.get("playback.intro_skip_mode")?.value;
      if (configuredMode === "never" || configuredMode === "ask" || configuredMode === "always") setIntroSkipMode(configuredMode);
      setAutoSkipCredits(settings.get("playback.auto_skip_credits")?.value === true);
      setAutoPlayNext(settings.get("playback.auto_play_next")?.value !== false);
      const loadedAppearance = parseSubtitleAppearance(settings.get("playback.subtitle_appearance")?.value);
      const appearanceSource = settings.get("playback.subtitle_appearance")?.source;
      setAppearance(loadedAppearance);
      setAppearanceDeviceOnly(appearanceSource === "profile_device" || appearanceSource === "device");
      setSubtitleCss(subtitleCueCss(loadedAppearance));
      if (getSubtitleMatchesDevice(session.profileId)) void deviceCaptioningAppearance(loadedAppearance).then(value => { if (alive) setSubtitleCss(subtitleCueCss(value)); });
      setHideUnwatchedOverview(settings.get("catalog.hide_unwatched_episode_overviews")?.value === true);
      setHideUnwatchedImages(settings.get("catalog.hide_unwatched_episode_images")?.value === true);
      setSkipSeconds({ back: validSkip(settings.get("player.video_skip_back_seconds")?.value, DEFAULT_SKIP_BACK_SECONDS), forward: validSkip(settings.get("player.video_skip_forward_seconds")?.value, DEFAULT_SKIP_FORWARD_SECONDS) });
      setPlayerSettingsLoaded(true);
      const selectedVersion = watch.versions.find(entry => entry.file_id === choices?.fileId)
        ?? bestVersionForDevice(watch.versions, watch.user_data?.last_file_id);
      if (!selectedVersion) throw new Error("Silo did not return a playable media file.");
      setDetail(watch);
      setVersion(selectedVersion);
      const resumePosition = startPosition ?? watch.user_data?.position_seconds;
      const playbackStart = startPosition === 0
        ? 0
        : resumePositionWithRewind(resumePosition, localResumeRewindSeconds());
      const started = await startPlaybackV3(session, watch, selectedVersion, "auto", choices?.audioIndex ?? selectedVersion.effective_audio_track_index, choices?.subtitleOff ? -1 : choices?.subtitleIndex, playbackStart);
      if (!alive) { void stopPlayback(session, started.plan.session_id); return; }
      installPlan({ ...started, attemptedKeys: [] });
    }).catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Playback failed."))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
      closePlayback(false);
    };
  }, [closePlayback, installPlan, item, session, startPosition, choices]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const active = stateRef.current;
      const video = videoRef.current;
      if (active && video) void reportProgress(session, active.plan.session_id, sourcePosition(), video.paused).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [session, sourcePosition]);

  // Seek-preview sheets for the playing file; absent (404) simply means no
  // thumbnails. Re-read when the negotiated file changes.
  useEffect(() => {
    let alive = true;
    getTrickplay(session, item.Id, version?.file_id).then((result) => {
      if (!alive) return;
      trickplayReadAt.current = Date.now();
      setTrickplay(result);
    }).catch(() => alive && setTrickplay(null));
    return () => { alive = false; };
  }, [session, item.Id, version?.file_id]);

  // Intro / credits / recap markers; absent simply means no skip pills.
  useEffect(() => {
    let alive = true;
    getMarkers(session, item.Id).then((result) => alive && setMarkers(result)).catch(() => alive && setMarkers(null));
    return () => { alive = false; };
  }, [session, item.Id]);

  // HUD reveal: any key or pointer activity re-arms the 5s auto-hide, so the
  // controls can't vanish mid-navigation (Android re-arms on every keydown too).
  const revealHud = useCallback((focus?: "transport" | "scrubber") => {
    if (ui.current.panel) return; // hold the chrome steady while a panel is open
    setHud(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHud(false), CONTROLS_AUTO_HIDE_MS);
    if (focus === "transport") transportRef.current?.querySelector<HTMLElement>("button.primary")?.focus();
    if (focus === "scrubber") scrubberRef.current?.focus();
  }, []);

  const focusTransport = useCallback(() => {
    const current = document.activeElement;
    if (current instanceof HTMLElement && transportRef.current?.contains(current)) return;
    transportRef.current?.querySelector<HTMLElement>("button.primary")?.focus();
  }, []);

  /** Seek the negotiated stream to a source-timeline position (re-anchors when the server demands it). */
  const seekToPosition = useCallback((target: number) => {
    const video = videoRef.current;
    const active = stateRef.current;
    if (!video || !active) return;
    const offset = active.plan.timeline.timeline_offset_seconds;
    const localTarget = target - offset;
    pendingSeekTarget.current = target;
    if (pendingSeekTimer.current) window.clearTimeout(pendingSeekTimer.current);
    pendingSeekTimer.current = window.setTimeout(clearPendingSeek, 6000);
    const generation = ++seekGeneration.current;
    if (localTarget < 0 || !active.plan.timeline.can_seek_anywhere) {
      setBusy(true);
      void replanPlaybackV3(session, active, "seek_reanchor", target, qualityRef.current, active.plan.selected_tracks)
        .then(next => { if (generation === seekGeneration.current) installPlan(next); })
        .catch(reason => { if (generation === seekGeneration.current) setError(reason instanceof Error ? reason.message : "Silo could not seek to that position."); })
        .finally(() => { if (generation === seekGeneration.current) setBusy(false); });
    } else {
      video.currentTime = Math.max(0, localTarget);
    }
    setPosition(target);
  }, [clearPendingSeek, installPlan, session]);

  const stopAutoSeek = useCallback(() => {
    if (autoSeekLoop.current) window.clearInterval(autoSeekLoop.current);
    autoSeekLoop.current = undefined;
    setAutoSeekRate(0);
  }, []);

  const cancelScrub = useCallback(() => {
    stopAutoSeek();
    pendingTapDirection.current = 0;
    setScrubPreview(null);
  }, [stopAutoSeek]);

  const commitScrub = useCallback(() => {
    const target = ui.current.scrubPreview;
    stopAutoSeek();
    pendingTapDirection.current = 0;
    setScrubPreview(null);
    if (target != null) seekToPosition(target);
  }, [seekToPosition, stopAutoSeek]);

  /** Begin a held Left/Right auto-seek on the focused bar at 1x — no ramp; taps step the rate. */
  function beginAutoSeek(direction: number) {
    if (autoSeekLoop.current) window.clearInterval(autoSeekLoop.current);
    const sign = direction < 0 ? -1 : 1;
    let preview = clampSeek(sourcePosition(), ui.current.duration);
    setScrubPreview(preview);
    setAutoSeekRate(sign);
    let lastTickAt = performance.now();
    autoSeekLoop.current = window.setInterval(() => {
      const now = performance.now();
      preview = clampSeek(preview + elapsedSeekSeconds(ui.current.autoSeekRate, now - lastTickAt), ui.current.duration);
      lastTickAt = now;
      setScrubPreview(preview);
    }, TICK_MS);
  }

  const stopCleanSeek = useCallback(() => {
    if (cleanSeekLoop.current) window.clearInterval(cleanSeekLoop.current);
    if (cleanSeekRamp.current) window.clearTimeout(cleanSeekRamp.current);
    if (cleanSeekHold.current) window.clearTimeout(cleanSeekHold.current);
    cleanSeekLoop.current = cleanSeekRamp.current = cleanSeekHold.current = undefined;
    pendingCleanPress.current = null;
    setCleanSeek(null);
  }, []);

  /** Begin the hidden-controls hold session at 1x, ramping 1 -> 2 -> 4 -> 8 on a 1.2s beat. */
  function beginCleanSeek(direction: number) {
    const sign = direction < 0 ? -1 : 1;
    const start = clampSeek(sourcePosition(), ui.current.duration);
    setSkipFeedback(null);
    setCleanSeek({ rate: sign, preview: start });
    let preview = start;
    let lastTickAt = performance.now();
    if (cleanSeekLoop.current) window.clearInterval(cleanSeekLoop.current);
    cleanSeekLoop.current = window.setInterval(() => {
      const now = performance.now();
      preview = clampSeek(preview + elapsedSeekSeconds(ui.current.cleanSeek?.rate ?? 0, now - lastTickAt), ui.current.duration);
      lastTickAt = now;
      setCleanSeek(current => current ? { ...current, preview } : current);
    }, TICK_MS);
    if (cleanSeekRamp.current) window.clearTimeout(cleanSeekRamp.current);
    let previous = sign;
    const ramp = (magnitudes: number[]) => {
      cleanSeekRamp.current = window.setTimeout(() => {
        if (ui.current.cleanSeek?.rate !== previous) return;
        const next = magnitudes[0];
        if (next == null) return;
        setCleanSeek(current => current ? { ...current, rate: next * sign } : current);
        previous = next;
        ramp(magnitudes.slice(1));
      }, RAMP_STEP_MS);
    };
    ramp(RAMP_RATES);
  }

  const commitCleanSeek = useCallback(() => {
    const held = ui.current.cleanSeek;
    stopCleanSeek();
    if (held) seekToPosition(held.preview);
  }, [seekToPosition, stopCleanSeek]);

  /** A quick skip: seek by the interval and surface the delta chip for 1.2s. */
  const performRelativeSeek = useCallback((deltaSeconds: number, reveal: boolean) => {
    const target = clampSeek(sourcePosition() + deltaSeconds, ui.current.duration);
    seekToPosition(target);
    nonceRef.current += 1;
    setSkipFeedback({ delta: Math.round(deltaSeconds), target, nonce: nonceRef.current });
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setSkipFeedback(null), SKIP_FEEDBACK_HIDE_MS);
    if (reveal) revealHud();
  }, [revealHud, seekToPosition]);

  // The intro pill's countdown creeps only while playback runs; a pause holds
  // the fill where it is (Android freezes the timer while paused).
  useEffect(() => {
    if (!pill || pill.secondsRemaining == null) return;
    const timer = window.setInterval(() => {
      if (videoRef.current?.paused) return;
      setPill(current => {
        if (!current || current.secondsRemaining == null) return current;
        const next = current.secondsRemaining - 0.25;
        if (next > 0) return { ...current, secondsRemaining: next };
        // The offer withdraws itself but is not resolved: it may re-offer once
        // the position leaves the range (Android's expired marker).
        if (current.kind === "intro") expiredMarkerKey.current = current.key;
        return null;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [pill?.key, pill?.secondsRemaining == null]);

  // The ask pill takes focus when it appears, unless a scrub owns attention.
  useEffect(() => {
    if (pill?.secondsRemaining != null && scrubPreview == null && document.activeElement !== pillRef.current) pillRef.current?.focus();
    if (!pill && document.activeElement && pillRef.current?.contains(document.activeElement)) focusTransport();
  }, [pill?.key, focusTransport]);

  // Which skip pill (if any) the position calls for. A resolved marker never
  // shows again this session; an expired intro offer waits for the position
  // to leave the range before re-offering.
  useEffect(() => {
    if (!playerSettingsLoaded || !markers || scrubPreview != null) return;
    const kinds: PillKind[] = ["intro", "credits", "recap"];
    const active = kinds.map(kind => ({ kind, segment: markers[kind] as MarkerSegment | null }))
      .find(entry => entry.segment && position >= entry.segment.start_seconds && position < entry.segment.end_seconds);
    const key = active ? `${active.kind}:${active.segment!.start_seconds}` : null;
    const introKey = markers.intro ? `intro:${markers.intro.start_seconds}` : null;
    if (pill?.undo && pill.key === introKey) return;
    if (pill && key === pill.key) return;
    if (!active || !key || resolvedMarkers.current.has(key) || expiredMarkerKey.current === key) {
      setPill(null);
    } else if (markerAction(active.kind, introSkipMode, autoSkipCredits) === "ignore") {
      setPill(null);
    } else if (markerAction(active.kind, introSkipMode, autoSkipCredits) === "skip") {
      if (!autoSkippedMarkers.current.has(key)) {
        autoSkippedMarkers.current.add(key);
        seekToPosition(active.segment!.end_seconds);
      }
      if (active.kind === "intro") setPill({ kind: "intro", key, label: "Watch Intro", secondsRemaining: INTRO_PROMPT_SECONDS, undo: true });
      else setPill(null);
    } else if (active.kind === "credits" && autoSkipCredits) {
      if (!autoSkippedMarkers.current.has(key)) {
        autoSkippedMarkers.current.add(key);
        seekToPosition(active.segment!.end_seconds);
      }
      setPill(null);
    } else if (active.kind === "intro") {
      setPill({ kind: "intro", key, label: "Skip Intro", secondsRemaining: INTRO_PROMPT_SECONDS });
    } else {
      setPill({ kind: active.kind, key, label: active.kind === "credits" ? "Skip Credits" : "Skip Recap", secondsRemaining: null });
    }
    if (expiredMarkerKey.current && expiredMarkerKey.current !== introKey) expiredMarkerKey.current = null;
  }, [markers, position, scrubPreview, playerSettingsLoaded, introSkipMode, autoSkipCredits, seekToPosition, pill?.key, pill?.undo]);

  const markersRef = useRef(markers);
  markersRef.current = markers;

  function selectPill() {
    const current = ui.current.pill;
    const activeMarkers = markersRef.current;
    if (!current || !activeMarkers) return;
    const segment = activeMarkers[current.kind];
    resolvedMarkers.current.add(current.key);
    setPill(null);
    if (segment) seekToPosition(current.undo ? segment.start_seconds : segment.end_seconds);
  }

  function dismissPill() {
    const current = ui.current.pill;
    if (!current) return;
    resolvedMarkers.current.add(current.key);
    setPill(null);
  }

  // Sheet thumbnails: preload the wanted sheet (and the next, so a forward
  // scrub rarely waits), cropped to one tile with cover math.
  const [, bumpSheets] = useState(0);
  const sheetImages = useRef(new Map<number, HTMLImageElement>());
  const sheetLoads = useRef(new Map<number, "loading" | "ready" | "failed">());
  const previewSeconds = scrubPreview ?? tapPreview;
  const wantedTile = trickplay && previewSeconds != null ? trickplayTileAt(trickplay, previewSeconds) : null;
  if (wantedTile) {
    for (const index of [wantedTile.sheet, wantedTile.sheet + 1]) {
      if (index >= trickplay!.sheets.length || sheetLoads.current.has(index)) continue;
      sheetLoads.current.set(index, "loading");
      const image = new Image();
      image.onload = () => {
        sheetLoads.current.set(index, "ready");
        sheetImages.current.set(index, image);
        bumpSheets(version => version + 1);
      };
      image.onerror = () => {
        // A refused sheet usually means the URLs expired: re-read the
        // manifest once (30s backoff), like Android's renewal path.
        sheetLoads.current.set(index, "failed");
        if (Date.now() - trickplayReadAt.current > 30_000) {
          trickplayReadAt.current = Date.now();
          sheetLoads.current.clear();
          getTrickplay(session, item.Id, version?.file_id).then(result => setTrickplay(result)).catch(() => setTrickplay(null));
        }
      };
      image.src = sheetUrl(session, item.Id, trickplay!.sheets[index].url);
    }
  }
  if (sheetImages.current.size > 12) {
    for (const index of Array.from(sheetImages.current.keys())) {
      if (index !== wantedTile?.sheet && index !== (wantedTile?.sheet ?? 0) + 1) {
        sheetImages.current.delete(index);
        sheetLoads.current.delete(index);
        if (sheetImages.current.size <= 12) break;
      }
    }
  }

  function tileBackground(displayWidth: number, displayHeight: number) {
    if (!trickplay || !wantedTile || sheetLoads.current.get(wantedTile.sheet) !== "ready") return null;
    const scale = Math.max(displayWidth / wantedTile.width, displayHeight / wantedTile.height);
    const offsetX = (displayWidth - wantedTile.width * scale) / 2;
    const offsetY = (displayHeight - wantedTile.height * scale) / 2;
    return {
      backgroundImage: `url(${sheetUrl(session, item.Id, trickplay.sheets[wantedTile.sheet].url)})`,
      backgroundSize: `${trickplay.tile_columns * wantedTile.width * scale}px ${trickplay.tile_rows * wantedTile.height * scale}px`,
      backgroundPosition: `${offsetX - wantedTile.x * scale}px ${offsetY - wantedTile.y * scale}px`
    };
  }

  async function replan(operation: "track_change" | "quality_change", quality: string, audio?: { id: string; index?: number }, subtitle?: { id: string; index?: number }) {
    const active = stateRef.current;
    if (!active) return;
    setBusy(true); setError("");
    try {
      const next = await replanPlaybackV3(session, active, operation, sourcePosition(), quality, { audio, subtitle });
      qualityRef.current = quality;
      installPlan(next);
      if (panel) {
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-hud-row="${hudTab === "Audio" ? "audio-track" : hudTab === "Subtitles" ? "subtitle-track" : "quality"}"]`)?.focus());
      } else {
        setPanel(null);
        revealHud();
        focusTransport();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Silo could not change playback."); }
    finally { setBusy(false); }
  }

  function selectAudio(track: AudioTrack, fallbackIndex?: number) {
    const index = track.index ?? fallbackIndex;
    if (index == null || !version) return;
    if (detail?.series_id) void saveAudioPreference(session, detail.series_id, track).catch(console.error);
    void replan("track_change", qualityRef.current, { id: `file:${version.file_id}:audio:${index}`, index }, plan?.selected_tracks.subtitle);
  }
  function selectSubtitle(track?: SubtitleInventory) {
    if (detail?.series_id) void saveSubtitlePreference(session, detail.series_id, track).catch(console.error);
    void replan("track_change", qualityRef.current, plan?.selected_tracks.audio, track ? { id: track.track_id, index: track.combined_index } : undefined);
  }
  async function preferredSubtitleLanguage() {
    let language = plan?.subtitle.inventory.find(track => track.track_id === plan.selected_tracks.subtitle?.id)?.language;
    try { const value = (await getEffectiveSettings(session, ["playback.subtitle_language"])).get("playback.subtitle_language")?.value; if (typeof value === "string" && value) language = value; } catch { /* keep fallback */ }
    return languageSearchCode(language);
  }
  async function openSubtitleSearch() {
    const language = await preferredSubtitleLanguage();
    setPanel(null);
    setHudPicker(null);
    setSubtitleSearch({ language });
  }
  async function openAiTranslate() {
    const language = await preferredSubtitleLanguage();
    setPanel(null);
    setHudPicker(null);
    setAiDialog({ language });
  }
  function closeAiTranslate() {
    setAiDialog(null);
    revealHud();
    focusTransport();
  }
  function closeSubtitleSearch() {
    setSubtitleSearch(null);
    revealHud();
    focusTransport();
  }
  async function refreshAfterSubtitleDownload() {
    const active = stateRef.current;
    if (!active) return false;
    const known = new Set(active.plan.subtitle.inventory.map(track => track.track_id));
    try {
      const refreshed = await replanPlaybackV3(session, active, "track_change", sourcePosition(), qualityRef.current, { audio: active.plan.selected_tracks.audio, subtitle: active.plan.selected_tracks.subtitle });
      const added = refreshed.plan.subtitle.inventory.filter(track => !known.has(track.track_id));
      if (!added.length) { installPlan(refreshed); return false; }
      const track = added[added.length - 1];
      if (detail?.series_id) void saveSubtitlePreference(session, detail.series_id, track).catch(console.error);
      const selected = await replanPlaybackV3(session, refreshed, "track_change", sourcePosition(), qualityRef.current, { audio: refreshed.plan.selected_tracks.audio, subtitle: { id: track.track_id, index: track.combined_index } });
      installPlan(selected);
      return true;
    } catch { return false; }
  }
  refreshAfterDownloadRef.current = refreshAfterSubtitleDownload;
  aiPositionRef.current = sourcePosition;
  const aiFileId = version?.file_id;
  useEffect(() => {
    if (aiFileId == null) return;
    const store = createAiTranslateStore(session, aiFileId, () => aiPositionRef.current(), () => refreshAfterDownloadRef.current());
    aiStore.current = { fileId: aiFileId, store };
    return () => { store.dispose(); if (aiStore.current?.store === store) aiStore.current = null; };
  }, [session, aiFileId]);
  useEffect(() => {
    if (!panel || hudTab !== "Subtitles" || aiStatusRequested.current) return;
    aiStatusRequested.current = true;
    getAiStatus(session).then(setAiStatus).catch(() => setAiStatus({ enabled: false, transcribe_enabled: false }));
  }, [panel, hudTab, session]);
  reloadSidecarRef.current = (key: string) => {
    const active = stateRef.current;
    const video = videoRef.current;
    if (!active || !video || active.plan.subtitle.inventory.find(track => track.track_id === active.plan.selected_tracks.subtitle?.id)?.sync_key !== key) return;
    const headers = { Authorization: `Bearer ${session.accessToken}`, ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}), ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {}), ...(active.plan.stream.headers ?? {}) };
    void attachSidecarSubtitle(video, active.plan, session, headers, sidecarTrack.current, subtitleDelayRef.current).then(track => { sidecarTrack.current = track; }).catch(() => undefined);
  };
  useEffect(() => {
    if (aiFileId == null) return;
    const store = createSubtitleSyncStore(session, aiFileId, key => reloadSidecarRef.current(key));
    syncStore.current = store;
    setSyncUi(store.get());
    const unsubscribe = store.subscribe(() => setSyncUi(store.get()));
    return () => { unsubscribe(); store.dispose(); if (syncStore.current === store) syncStore.current = null; setSyncUi(emptySync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, aiFileId]);
  const syncKeys = (plan?.subtitle.inventory ?? []).map(track => track.sync_key).filter((key): key is string => Boolean(key)).join("|");
  useEffect(() => {
    if (!panel || hudTab !== "Subtitles" || !syncKeys) return;
    void syncStore.current?.reload(syncKeys.split("|"));
  }, [panel, hudTab, syncKeys]);
  function selectQuality(quality: Quality | { label: string }) {
    void replan("quality_change", quality.label, plan?.selected_tracks.audio, plan?.selected_tracks.subtitle);
  }

  async function selectFileVersion(nextVersion: PlayerFileVersion) {
    if (!detail || !version || nextVersion.file_id === version.file_id || busy) return;
    const positionNow = sourcePosition();
    const previousVersion = version;
    const audioIndex = nextVersion.audio_tracks?.some(track => track.index === selectedAudioTrack?.index)
      ? selectedAudioTrack?.index
      : nextVersion.effective_audio_track_index;
    const matchingSubtitleIndex = activeSubtitle
      ? nextVersion.subtitle_tracks?.findIndex(track => track.language === activeSubtitle.language && track.forced === activeSubtitle.forced)
      : undefined;
    const subtitleIndex = activeSubtitle ? (matchingSubtitleIndex != null && matchingSubtitleIndex >= 0 ? matchingSubtitleIndex : undefined) : -1;
    setBusy(true);
    setError("");
    closePlayback(false);
    try {
      const started = await startPlaybackV3(session, detail, nextVersion, qualityRef.current, audioIndex, subtitleIndex != null && subtitleIndex >= 0 ? subtitleIndex : subtitleIndex === -1 ? -1 : undefined, positionNow);
      setVersion(nextVersion);
      installPlan({ ...started, attemptedKeys: [] });
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-hud-row="version"]')?.focus());
    } catch (reason) {
      setVersion(previousVersion);
      setError(reason instanceof Error ? reason.message : "Silo could not switch media version.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDolbyVision() {
    if (dolbyApplying || busy) return;
    const next = !dolbyOn;
    setDolbyOn(next);
    setLocalDolbyVisionEnabled(next);
    const active = stateRef.current;
    if (!active || !detail || !version) return;
    const isDolbyVision = active.plan.claims?.video?.dolby_vision === true || Boolean(active.plan.source?.dolby_vision_profile);
    if (!isDolbyVision) return;
    const wasPaused = videoRef.current?.paused ?? false;
    const positionNow = sourcePosition();
    const audio = active.plan.selected_tracks.audio;
    const subtitle = active.plan.selected_tracks.subtitle;
    setDolbyApplying(true);
    setBusy(true);
    setError("");
    closePlayback(false);
    try {
      const started = await startPlaybackV3(session, detail, version, qualityRef.current, audio?.index, subtitle ? subtitle.index : -1, positionNow);
      installPlan({ ...started, attemptedKeys: [] });
      if (wasPaused) requestAnimationFrame(() => videoRef.current?.pause());
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-hud-row="dolby-vision"]')?.focus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Silo could not restart playback for Dolby Vision.");
    } finally {
      setBusy(false);
      setDolbyApplying(false);
    }
  }

  function togglePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  /** Panels hold the chrome steady: opening one disarms the auto-hide. */
  const hudTabs: HudTab[] = ["Info", ...(plan ? ["Stats" as HudTab] : []), "Video", ...(version?.audio_tracks?.length ? ["Audio" as HudTab] : []), "Subtitles", ...(version?.chapters?.length ? ["Chapters" as HudTab] : [])];
  hudTabsRef.current = hudTabs;

  function focusHudEntry(tab = hudTab) {
    requestAnimationFrame(() => {
      const pane = document.querySelector<HTMLElement>(`[data-hud-pane="${tab}"]`);
      const target = pane?.querySelector<HTMLElement>("[data-tv-focusable='true']:not([disabled])");
      (target ?? document.querySelector<HTMLElement>(`[data-hud-tab="${tab}"]`))?.focus();
    });
  }

  function openPanel(name: "audio" | "subtitles" | "quality") {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    setPanel(name);
    const target: HudTab = name === "audio" ? "Audio" : name === "subtitles" ? "Subtitles" : "Video";
    setHudTab(target);
    focusHudEntry(target);
  }

  function selectHudTab(tab: typeof hudTab) {
    setHudTab(tab);
    focusHudEntry(tab);
  }

  const hasSidecarSubtitle = Boolean(plan && sidecarSubtitleArtifact(plan));
  const timingActions = timingActionsFor(syncUi, plan?.subtitle.inventory.find(track => track.track_id === plan.selected_tracks.subtitle?.id)?.sync_key);

  function delayChoices(from: number, to: number, step: number) {
    const list: Array<{ label: string; value: string }> = [];
    for (let value = from; value <= to; value += step) list.push({ label: delayLabel(value), value: String(value) });
    return list;
  }

  function changeSubtitleDelay(value: number) {
    setSubtitleDelayMs(value);
    setLocalSubtitleSyncMs(value);
    if (sidecarTrack.current) applySubtitleDelay(sidecarTrack.current, value);
  }

  function changeAudioDelay(value: number) {
    setAudioDelayMs(value);
    setLocalAudioSyncMs(value);
  }

  function presentHudPicker(title: string, choices: Array<{ label: string; value: string }>, selected: string, returnKey: string, onSelect: (value: string) => void) {
    setHudPicker({ title, choices, selected, returnKey, onSelect });
    requestAnimationFrame(() => {
      const selectedRow = document.querySelector<HTMLElement>(`.player-hud-picker [data-picker-value="${selected}"]`);
      (selectedRow ?? document.querySelector<HTMLElement>(".player-hud-picker [data-tv-focusable='true']"))?.focus();
    });
  }

  function chooseHudPicker(value: string) {
    const picker = hudPickerRef.current;
    if (!picker) return;
    picker.onSelect(value);
    setHudPicker(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-hud-row="${picker.returnKey}"]`)?.focus());
  }

  function changeAppearance(key: keyof SubtitleAppearance, value: unknown) {
    if (!appearance) return;
    const next = { ...appearance, [key]: value } as SubtitleAppearance;
    setAppearance(next);
    if (getSubtitleMatchesDevice(session.profileId)) void deviceCaptioningAppearance(next).then(value => setSubtitleCss(subtitleCueCss(value)));
    else setSubtitleCss(subtitleCueCss(next));
    setStyleView("list");
    const save = appearanceDeviceOnly ? putDeviceSubtitleAppearance(session, next) : putProfileSubtitleAppearance(session, next);
    void save.catch(() => setError("Could not save subtitle appearance."));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-style-key='${key}']`)?.focus());
  }

  function exitPlayer() {
    stopAutoSeek();
    stopCleanSeek();
    closePlayback(false);
    onBack(videoRef.current?.currentTime ?? 0);
  }

  function handleMediaError() {
    const video = videoRef.current;
    const mediaError = video?.error;
    const labels: Record<number, string> = { 1: "aborted", 2: "network", 3: "decode", 4: "unsupported source" };
    const reason = mediaError ? labels[mediaError.code] ?? `code ${mediaError.code}` : "unknown error";
    const diagnostics = {
      reason,
      mediaErrorCode: mediaError?.code,
      mediaErrorMessage: mediaError?.message,
      networkState: video?.networkState,
      readyState: video?.readyState,
      delivery: stateRef.current?.plan.delivery,
      protocol: stateRef.current?.plan.stream.protocol,
      container: stateRef.current?.plan.stream.container,
      mimeType: stateRef.current?.plan.stream.mime_type,
      streamUrl: video?.currentSrc || video?.src
    };
    clientDiagnostic("LG media playback failed", diagnostics);
    setError(`LG playback error: ${reason} · ${diagnostics.delivery ?? "unknown route"} · ${diagnostics.container ?? diagnostics.mimeType ?? "unknown format"}`);
  }

  // The remote-key map, mirroring TvPlayerRemoteKeyAction: Play/Pause acts on
  // the first press; Left/Right skip from clean playback (hold to preview) and
  // belong to focus navigation with the overlay up; Down focuses the
  // transport; Back exits or cancels; an unmapped key from clean playback
  // reveals the controls and is swallowed.
  useEffect(() => {
    const isBackKey = (event: KeyboardEvent) => event.key === "Escape" || event.key === "Backspace" || event.keyCode === 461 || event.keyCode === 10009;

    function moveTransport(delta: number) {
      const buttons = Array.from(transportRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []).filter(button => button.offsetParent !== null);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = index >= 0 ? buttons[index + delta] : undefined;
      if (next) next.focus();
      else if (index < 0 && buttons[0]) buttons[0].focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (ui.current.upNextOpen) {
        if (isBackKey(event)) {
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) document.querySelector<HTMLElement>(".player-next-up [data-setting='keep']")?.click() ?? document.querySelector<HTMLElement>(".player-next-up [data-setting='back']")?.click();
          return;
        }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) return;
          const modal = document.querySelector<HTMLElement>(".player-next-up");
          const rows = Array.from(modal?.querySelectorAll<HTMLElement>("[data-tv-focusable='true']:not([disabled])") ?? []);
          const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          if (!active || !modal?.contains(active)) { rows[0]?.focus(); return; }
          const center = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
          const p = center(active);
          const dir = event.key.slice(5).toLowerCase();
          const next = rows.filter(el => el !== active).map(el => ({ el, p: center(el) })).filter(x => dir === "left" || dir === "right" ? Math.abs(x.p.y-p.y) < Math.max(active.offsetHeight,x.el.offsetHeight) : dir === "down" ? x.p.y > p.y : x.p.y < p.y).filter(x => dir === "left" ? x.p.x < p.x : dir === "right" ? x.p.x > p.x : true).sort((a,b) => dir === "left" || dir === "right" ? Math.abs(a.p.x-p.x)-Math.abs(b.p.x-p.x) : Math.abs(a.p.y-p.y)*1000+Math.abs(a.p.x-p.x)-Math.abs(b.p.y-p.y)*1000-Math.abs(b.p.x-p.x))[0]?.el;
          if (next) {
            next.focus({ preventScroll: true });
            const rail = next.closest<HTMLElement>(".player-on-deck-row");
            const railLeft = rail?.scrollLeft ?? 0;
            next.scrollIntoView({ block: "nearest", inline: "nearest" });
            if (rail) { rail.scrollLeft = railLeft; pinFocusedRailItem(next); }
          }
          return;
        }
        if (event.key === "Enter" || event.key === "OK" || event.key === " ") {
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) (document.activeElement as HTMLElement | null)?.click();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); }
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      const snapshot = ui.current;

      // Playback panels own the keys while open: Up/Down walk the rows, OK
      // presses, Back closes, Left/Right are consumed.
      if (snapshot.panel && !lgMediaKey(event)) {
        if (isBackKey(event) && hudPickerRef.current) {
          event.preventDefault(); event.stopPropagation();
          const returnKey = hudPickerRef.current.returnKey;
          setHudPicker(null);
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-hud-row="${returnKey}"]`)?.focus());
          return;
        }
        if (isBackKey(event) && styleViewRef.current) {
          event.preventDefault(); event.stopPropagation();
          const field = styleViewRef.current;
          setStyleView(field === "list" || field === "timing" ? null : "list");
          requestAnimationFrame(() => document.querySelector<HTMLElement>(field === "list" ? "[data-style-entry]" : field === "timing" ? "[data-timing-entry]" : `[data-style-key='${field}']`)?.focus());
          return;
        }
        if (isBackKey(event)) {
          event.preventDefault(); event.stopPropagation();
          setStyleView(null);
          setPanel(null);
          revealHud();
          focusTransport();
          return;
        }
        if (hudPickerRef.current && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) return;
          const rows = Array.from(document.querySelectorAll<HTMLElement>(".player-hud-picker [data-tv-focusable='true']"));
          const index = rows.indexOf(document.activeElement as HTMLElement);
          rows[event.key === "ArrowDown" ? index + 1 : index - 1]?.focus();
          return;
        }
        const activeTab = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-hud-tab]") : null;
        if (activeTab && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) return;
          const tab = activeTab.dataset.hudTab as HudTab;
          const tabs = hudTabsRef.current;
          const index = tabs.indexOf(tab);
          document.querySelector<HTMLElement>(`[data-hud-tab="${tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]}"]`)?.focus();
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) return;
          if (activeTab) {
            if (event.key === "ArrowDown") {
              const pane = document.querySelector<HTMLElement>(`[data-hud-pane="${activeTab.dataset.hudTab}"]`);
              pane?.querySelector<HTMLElement>("[data-tv-focusable='true']:not([disabled])")?.focus();
            }
            return;
          }
          const pane = document.querySelector<HTMLElement>(`[data-hud-pane="${snapshot.hudTab}"]`);
          const rows = Array.from(pane?.querySelectorAll<HTMLElement>("[data-tv-focusable='true']:not([disabled])") ?? []).filter(row => row.offsetParent !== null);
          const index = rows.indexOf(document.activeElement as HTMLElement);
          if (event.key === "ArrowUp" && index <= 0) document.querySelector<HTMLElement>(`[data-hud-tab="${snapshot.hudTab}"]`)?.focus();
          else rows[event.key === "ArrowDown" ? index + 1 : index - 1]?.focus();
          return;
        }
        if (event.key === "Enter" || event.key === "OK" || event.key === " ") {
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) (document.activeElement as HTMLElement | null)?.click();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) return;
          const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const column = current?.closest<HTMLElement>(".player-hud-video-grid > div, .player-hud-columns > div");
          const sibling = event.key === "ArrowRight" ? column?.nextElementSibling : column?.previousElementSibling;
          if (current && column && sibling instanceof HTMLElement) {
            const rowsOf = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("[data-tv-focusable='true']:not([disabled])")).filter(row => row.offsetParent !== null);
            const target = rowsOf(sibling);
            const index = Math.max(0, rowsOf(column).indexOf(current));
            target[Math.min(index, target.length - 1)]?.focus();
          }
          return;
        }
        return;
      }

      // Any key activity re-arms the auto-hide while the overlay is up.
      if (snapshot.hud) revealHud();

      // Dedicated transport seek keys skip in every surface state.
      const mediaKey = lgMediaKey(event);
      if (mediaKey === "rewind") {
        event.preventDefault(); event.stopPropagation();
        stopCleanSeek();
        performRelativeSeek(-skipRef.current.back, true);
        return;
      }
      if (mediaKey === "forward") {
        event.preventDefault(); event.stopPropagation();
        stopCleanSeek();
        performRelativeSeek(skipRef.current.forward, true);
        return;
      }
      if (mediaKey === "play" || mediaKey === "pause" || mediaKey === "playpause") {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) {
          if (snapshot.cleanSeek) commitCleanSeek();
          else if (mediaKey === "play" && video.paused) togglePlayPause();
          else if (mediaKey === "pause" && !video.paused) togglePlayPause();
          else if (mediaKey === "playpause") togglePlayPause();
        }
        return;
      }
      if (mediaKey === "stop") {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) exitPlayer();
        return;
      }

      const onScrubber = document.activeElement === scrubberRef.current;
      const onTransportButton = document.activeElement instanceof HTMLElement && transportRef.current?.contains(document.activeElement) === true;
      const onPill = document.activeElement instanceof HTMLElement && pillRef.current?.contains(document.activeElement) === true;

      // A skip pill owns Back (dismiss + resolve) and Select when it holds focus.
      if (snapshot.pill && isBackKey(event)) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) dismissPill();
        return;
      }

      if (isBackKey(event)) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) {
          if (snapshot.cleanSeek) stopCleanSeek();
          else if (snapshot.scrubPreview != null) cancelScrub();
          else exitPlayer();
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        if (onScrubber) focusTransport();
        else if (onPill) revealHud("transport");
        else if (onTransportButton) { /* bottom row: stay */ }
        else if (snapshot.cleanSeek) stopCleanSeek();
        else if (!snapshot.hud) {
          const tab: HudTab = snapshot.audioAvailable ? "Audio" : snapshot.subtitlesAvailable ? "Subtitles" : "Video";
          setPanel(tab === "Audio" ? "audio" : tab === "Subtitles" ? "subtitles" : "quality");
          setHudTab(tab);
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-hud-tab="${tab}"]`)?.focus());
        } else revealHud("transport");
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        if (onTransportButton) scrubberRef.current?.focus();
        else if (onScrubber && snapshot.pill) pillRef.current?.focus();
        else if (!snapshot.hud && !onPill && !snapshot.cleanSeek) revealHud("transport");
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        if (!snapshot.hud) {
          // Clean playback: tap = quick skip, hold = preview session.
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) return;
          if (snapshot.cleanSeek) {
            // The viewer driving: adjust the rate along the signed ladder.
            if (cleanSeekRamp.current) window.clearTimeout(cleanSeekRamp.current);
            setCleanSeek(current => current ? { ...current, rate: bumpedRate(current.rate, direction) } : current);
            return;
          }
          const generation = ++nonceRef.current;
          pendingCleanPress.current = { direction, generation, becameHold: false };
          cleanSeekHold.current = window.setTimeout(() => {
            const press = pendingCleanPress.current;
            if (!press || press.generation !== generation) return;
            pendingCleanPress.current = { ...press, becameHold: true };
            beginCleanSeek(direction);
          }, CLEAN_SEEK_HOLD_THRESHOLD_MS);
          return;
        }
        if (onScrubber) {
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) {
            // First repeat marks a hold: engage timeline auto-seek and forget
            // the pending tap so the hold does not also skip.
            pendingTapDirection.current = 0;
            if (ui.current.autoSeekRate === 0) beginAutoSeek(direction);
            return;
          }
          pendingTapDirection.current = direction;
          return;
        }
        if (onTransportButton) {
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) moveTransport(direction);
          return;
        }
        if (onPill) {
          event.preventDefault(); event.stopPropagation();
          return;
        }
        return;
      }

      // OK acts on keyup (commit semantics), so keydown only claims the press.
      if (event.key === "Enter" || event.key === "OK" || event.key === " ") {
        event.preventDefault(); event.stopPropagation();
        return;
      }

      // An unmapped key from clean playback reveals the controls and is
      // swallowed; with the overlay up it falls through.
      if (!snapshot.hud) {
        revealHud("transport");
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      const snapshot = ui.current;

      if (event.key === "Enter" || event.key === "OK" || event.key === " ") {
        event.preventDefault(); event.stopPropagation();
        if (snapshot.panel) return; // the keydown already pressed the row
        const onPill = document.activeElement instanceof HTMLElement && pillRef.current?.contains(document.activeElement) === true;
        if (onPill) { selectPill(); return; }
        // A visible pill owns Select when no control does (it is not reliably
        // in the focus tree, so the surface routes for it).
        if (snapshot.pill && !(document.activeElement === scrubberRef.current || transportRef.current?.contains(document.activeElement))) { selectPill(); return; }
        if (!snapshot.hud) {
          togglePlayPause();
          revealHud("transport");
          return;
        }
        const onScrubber = document.activeElement === scrubberRef.current;
        if (onScrubber || snapshot.scrubPreview != null) {
          // "Center means here": land any scrub in flight, then flip playback.
          commitScrub();
          togglePlayPause();
          return;
        }
        if (document.activeElement instanceof HTMLElement && transportRef.current?.contains(document.activeElement)) {
          (document.activeElement as HTMLElement).click();
          return;
        }
        togglePlayPause();
        if (!snapshot.hud) revealHud("transport");
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        if (!snapshot.hud && !snapshot.panel) {
          event.preventDefault(); event.stopPropagation();
          const press = pendingCleanPress.current;
          if (!press || press.direction !== direction) return;
          const held = press.becameHold || snapshot.cleanSeek != null;
          pendingCleanPress.current = null;
          if (cleanSeekHold.current) window.clearTimeout(cleanSeekHold.current);
          if (held) commitCleanSeek();
          else performRelativeSeek(direction < 0 ? -skipRef.current.back : skipRef.current.forward, true);
          return;
        }
        if (document.activeElement === scrubberRef.current) {
          event.preventDefault(); event.stopPropagation();
          if (pendingTapDirection.current === direction) {
            pendingTapDirection.current = 0;
            if (ui.current.autoSeekRate !== 0) {
              setAutoSeekRate(rate => bumpedRate(rate, direction));
            } else if (ui.current.scrubPreview != null) {
              const step = direction < 0 ? -skipRef.current.back : skipRef.current.forward;
              setScrubPreview(current => clampSeek((current ?? 0) + step, ui.current.duration));
            } else {
              const delta = direction < 0 ? -skipRef.current.back : skipRef.current.forward;
              const target = clampSeek(sourcePosition() + delta, ui.current.duration);
              setTapPreview(target);
              if (tapPreviewTimer.current) window.clearTimeout(tapPreviewTimer.current);
              tapPreviewTimer.current = window.setTimeout(() => setTapPreview(null), 1500);
              performRelativeSeek(delta, false);
            }
          }
          return;
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      stopAutoSeek();
      stopCleanSeek();
    };
  }, [cancelScrub, commitCleanSeek, commitScrub, focusTransport, performRelativeSeek, revealHud, stopAutoSeek, stopCleanSeek]);

  // First focus lands on the transport's Play/Pause once the shell is
  // interactive, matching the overlay's default focus target.
  useEffect(() => {
    if (busy || error) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    focusTransport();
  }, [busy, error, focusTransport]);

  const episodeCode = detail?.season_number != null && detail.episode_number != null ? `S${detail.season_number}:E${detail.episode_number}` : "";
  const eyebrowText = (detail?.series_title || item.SeriesName)
    ? [detail?.series_title ?? item.SeriesName, episodeCode].filter(Boolean).join(" · ")
    : "Movie";
  const audioTracks = version?.audio_tracks ?? [];
  const plannedAudioIndex = Number(plan?.selected_tracks.audio?.id.match(/audio:(\\d+)$/)?.[1]);
  const effectiveAudioIndex = Number.isFinite(plannedAudioIndex) ? plannedAudioIndex : version?.effective_audio_track_index;
  const selectedAudioTrack = audioTracks.find(track => track.index === effectiveAudioIndex) ?? audioTracks.find(track => track.default) ?? audioTracks[0];
  const audioTrackDescription = (track: AudioTrack | undefined, index = 0) => track ? [track.title || track.language || `Track ${index + 1}`, track.codec?.toUpperCase(), track.channels ? `${track.channels} ch` : ""].filter(Boolean).join(" · ") : "Default";
  const subtitles = plan?.subtitle.inventory ?? [];
  const qualities = plan?.available_qualities ?? [];
  const chapters = version?.chapters ?? [];
  const labelSeconds = scrubPreview ?? position;
  const remaining = Math.max(0, duration - labelSeconds);
  const endsAt = remaining > 0 ? new Date(Date.now() + remaining / playbackSpeed * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const playedFraction = duration > 0 ? Math.max(0, Math.min(1, labelSeconds / duration)) : 0;
  const bufferedFraction = duration > 0 ? Math.max(0, Math.min(1, (position + bufferedAhead) / duration)) : 0;
  const selectedSubtitle = plan?.selected_tracks.subtitle;
  const activeSubtitle = selectedSubtitle ? subtitles.find(track => track.track_id === selectedSubtitle.id) : null;
  const subtitleValue = activeSubtitle ? subtitleName(activeSubtitle) : "Off";
  const previewCard = tileBackground(320, 180);
  const holdCard = cleanSeek ? tileBackground(480, 270) : null;
  const holdTile = cleanSeek && trickplay ? trickplayTileAt(trickplay, cleanSeek.preview) : null;
  const pillFill = pill?.secondsRemaining != null ? 1 - pill.secondsRemaining / INTRO_PROMPT_SECONDS : null;

  // Segmented track: chapter starts become 2px gaps (dropped when a title has
  // so many short chapters that segments stop reading as bars).
  const trackEstimateWidth = Math.max(320, (typeof window !== "undefined" ? window.innerWidth : 1920) - 96);
  const chapterBounds = duration > 0 ? chapters.map(chapter => chapter.start_seconds / duration).filter(fraction => fraction > 0.001 && fraction < 0.999).sort((a, b) => a - b) : [];
  const edges = [0, ...chapterBounds, 1];
  const denseGaps = chapterBounds.length > 0 && edges.some((edge, index) => index > 0 && (edge - edges[index - 1]) * trackEstimateWidth < 16);
  const segments: Array<[number, number]> = denseGaps ? [[0, 1]] : edges.slice(0, -1).map((edge, index) => [edge, edges[index + 1]] as [number, number]);
  const bandRanges = (["intro", "recap", "credits", "preview"] as const)
    .map(kind => ({ kind, segment: (markers?.[kind] ?? null) as MarkerSegment | null }))
    .filter((entry): entry is { kind: typeof entry.kind; segment: MarkerSegment } => entry.segment != null && entry.segment.end_seconds > entry.segment.start_seconds);

  return <main className="player-shell" onMouseMove={() => revealHud()}>
    {subtitleCss ? <style>{subtitleCss}</style> : null}
    <video ref={videoRef} className={upNextRect ? "player player-in-next-up" : "player"} style={{ objectFit: aspectMode === "Stretch" ? "fill" : aspectMode === "Zoom" ? "cover" : "contain", ...(upNextRect ? { left: upNextRect.left, top: upNextRect.top, width: upNextRect.width, height: upNextRect.height } : {}) }} playsInline
      onPlay={() => { setPlaying(true); revealHud(); }}
      onPause={() => { setPlaying(false); revealHud(); }}
      onEnded={handleMediaEnded}
      onSeeked={event => {
        releaseReachedSeek(event.currentTarget);
        setPosition(sourcePosition());
      }}
      onTimeUpdate={event => {
        releaseReachedSeek(event.currentTarget);
        setPosition(sourcePosition());
        const video = event.currentTarget;
        setDuration(version?.duration ?? video.duration ?? 0);
        setBufferedAhead(Math.max(0, video.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0));
      }}
      onDurationChange={event => setDuration(version?.duration ?? event.currentTarget.duration ?? 0)}
      onProgress={event => {
        const video = event.currentTarget;
        setBufferedAhead(Math.max(0, video.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0));
      }}
      onError={handleMediaError} />

    <div className={`player-chrome ${hud ? "visible" : ""}`}>
      <div className="player-scrim" />
      <div className="player-overlay-block">
        {eyebrowText ? <div className="player-eyebrow">{eyebrowText}</div> : null}
        <h2 className="player-title-text">{detail?.title ?? item.Name}</h2>

        <div ref={scrubberRef} className="player-scrubber" tabIndex={-1} data-active={scrubberFocused || scrubPreview != null} data-focused={scrubberFocused}
          onFocus={() => setScrubberFocused(true)} onBlur={() => setScrubberFocused(false)}>
          {previewSeconds != null && (previewCard || autoSeekRate !== 0) ? <div className="scrub-preview-stack" data-fast={autoSeekRate !== 0} style={{ left: `clamp(168px, ${playedFraction * 100}%, calc(100% - 168px))` }}>
            {previewCard ? <div className="scrub-preview-card">
              <div className="trickplay-frame" style={previewCard} />
              <span className="scrub-preview-time">{formatClock(previewSeconds)}</span>
            </div> : null}
            {autoSeekRate !== 0 ? <div className="auto-seek-chip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={autoSeekRate < 0 ? "M20.8 6.4 19.1 9.2 16.2 7.9" : "M3.2 6.4 4.9 9.2 7.8 7.9"} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><path d={autoSeekRate < 0 ? "M12 4a8 8 0 1 0 7.4 4.9" : "M12 4a8 8 0 1 1-7.4 4.9"} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>{Math.abs(autoSeekRate)}x</div> : null}
          </div> : null}
          {skipFeedback && !cleanSeek && !panel && !upNextCard && hud ? <div className="skip-feedback-docked" data-raised={previewSeconds != null && previewCard != null} data-nonce={skipFeedback.nonce}><div className="skip-feedback-chip"><strong>{skipFeedback.delta < 0 ? `−${-skipFeedback.delta}s` : `+${skipFeedback.delta}s`}</strong><span>{formatClock(skipFeedback.target)}</span></div></div> : null}
          <div ref={timelineRef} className="scrub-bar" role="slider" aria-label="Playback position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(labelSeconds)} tabIndex={-1}>
            {segments.map(([start, end], index) => {
              const span = end - start;
              if (span <= 0) return null;
              const local = (fraction: number) => Math.max(0, Math.min(1, (fraction - start) / span));
              const innerLeft = index === 0 ? 0 : 2;
              const innerRight = index === segments.length - 1 ? 0 : 2;
              return <div key={index} className="scrub-segment" style={{ left: `calc(${start * 100}% + ${innerLeft}px)`, width: `calc(${span * 100}% - ${innerLeft + innerRight}px)` }}>
                {bandRanges.map(({ kind, segment }) => {
                  const bandStart = Math.max(segment.start_seconds / (duration || 1), start);
                  const bandEnd = Math.min(segment.end_seconds / (duration || 1), end);
                  if (bandEnd <= bandStart) return null;
                  return <i key={kind} className="scrub-band" style={{ left: `${local(bandStart) * 100}%`, width: `${(local(bandEnd) - local(bandStart)) * 100}%`, background: BAND_COLORS[kind] }} />;
                })}
                <b className="scrub-buffered" style={{ width: `${local(bufferedFraction) * 100}%` }} />
                <b className="scrub-fill" style={{ width: `${local(playedFraction) * 100}%` }} />
              </div>;
            })}
            <b className="scrub-puck" style={{ left: `${playedFraction * 100}%`, opacity: scrubberFocused || scrubPreview != null ? 1 : 0 }} />
          </div>
          <div className="scrub-clocks">
            <span>{formatClock(labelSeconds)}</span>
            <span>{remaining > 0 ? `−${formatClock(remaining)}${endsAt ? ` · Ends ${endsAt}` : ""}` : ""}</span>
          </div>
        </div>

        <div ref={transportRef} className="player-transport">
          <div className="transport-group">
            <button className="transport-button" onClick={() => performRelativeSeek(-skipRef.current.back, true)} aria-label={`Skip back ${skipSeconds.back} seconds`}><TransportGlyph name="back10" seconds={skipSeconds.back} /></button>
            <button className="transport-button primary" onClick={togglePlayPause} aria-label={playing ? "Pause" : "Play"}><TransportGlyph name={playing ? "pause" : "play"} /></button>
            <button className="transport-button" onClick={() => performRelativeSeek(skipRef.current.forward, true)} aria-label={`Skip forward ${skipSeconds.forward} seconds`}><TransportGlyph name="forward30" seconds={skipSeconds.forward} /></button>
          </div>
          <div className="transport-group">
            {upNext ? <button className="transport-button labeled" onClick={() => commitApproachingEnd(false)} aria-label="Up Next"><TransportGlyph name="upNext" /><span>Up next</span></button> : null}
            <button className="transport-button labeled" onClick={() => openPanel("subtitles")} aria-label={`Subtitles${subtitleValue ? ` · ${subtitleValue}` : ""}`}><TransportGlyph name="subtitles" /><span>Subtitles</span><small>{subtitleValue}</small></button>
            <button className="transport-button labeled" onClick={() => openPanel("quality")} aria-label="Options"><TransportGlyph name="tune" /><span>Options</span></button>
            <button className="transport-button labeled" onClick={exitPlayer} aria-label="Close player"><TransportGlyph name="close" /><span>Close</span></button>
          </div>
        </div>
      </div>

      {pill && !panel && !upNextCard ? <div className="skip-pill" data-controls={hud}>
        {pill.undo ? <small className="skip-pill-caption">Intro skipped</small> : null}
        <div ref={pillRef} className="skip-pill-capsule" tabIndex={-1} onClick={selectPill} data-prompt={pill.kind}>
          {pillFill != null ? <b className="skip-pill-fill" style={{ width: `${Math.max(0, Math.min(1, pillFill)) * 100}%` }} /> : null}
          <span>{pill.label}</span>
        </div>
      </div> : null}

      {cleanSeek ? <div className="hold-seek-indicator">
        <div className="hold-seek-frame" style={holdCard ?? undefined} />
        <div className="hold-seek-chip"><strong>{cleanSeek.rate === 0 ? "Paused" : `${cleanSeek.rate < 0 ? "-" : ""}${Math.abs(cleanSeek.rate)}×`}</strong><span>{formatClock(cleanSeek.preview)}</span></div>
        {duration > 0 ? <div className="hold-seek-track"><b style={{ width: `${Math.max(0, Math.min(1, cleanSeek.preview / duration)) * 100}%` }} /></div> : null}
        <div className="hold-seek-hint">← → speed · ◉ play · ↩ cancel</div>
      </div> : null}

      {skipFeedback && !cleanSeek && !panel && !upNextCard && !hud ? <div className="skip-feedback" data-nonce={skipFeedback.nonce} data-controls={hud}>
        <div className="skip-feedback-chip"><strong>{skipFeedback.delta < 0 ? `−${-skipFeedback.delta}s` : `+${skipFeedback.delta}s`}</strong><span>{formatClock(skipFeedback.target)}</span></div>
        {!hud && duration > 0 ? <div className="skip-feedback-track"><b style={{ width: `${Math.max(0, Math.min(1, skipFeedback.target / duration)) * 100}%` }} /></div> : null}
      </div> : null}

      {busy ? <div className="player-loading" role="status" aria-label="Loading"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" /></svg></div> : null}
      {error ? <div className="player-error" role="alert">{error}</div> : null}
    </div>

    {upNextCard ? <section className="player-next-up" data-modal="true" aria-label="Up next">
      {nextUpBackdrop ? <img className="player-next-up-backdrop" src={nextUpBackdrop} alt="" /> : null}
      <div className="player-next-up-main"><div className="player-next-up-card">
        <div ref={upNextPane} className="player-next-up-pane" />
        <div className="player-next-up-panel">
          {shuffle && shuffleScope ? <div className="player-next-up-scope"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" /></svg><span>Shuffling {shuffleScope}</span></div> : null}
          <div className="player-next-up-eyebrow">{!upNext ? (upNextCard.videoEnded ? "Finished" : "More To Watch") : shuffle ? "Up Next at Random" : upNextCard.videoEnded ? "Playing Next" : "Up Next"}</div>
          {upNext ? <>
            {upNext.Type === "Episode" || !shuffle ? <h2>{upNext.SeriesName || detail?.series_title || item.SeriesName || "Next Episode"}</h2> : <h2>{upNext.Name}</h2>}
            {upNext.Type === "Episode" || !shuffle ? <div className="player-next-up-line">
              {upNext.ParentIndexNumber != null && upNext.IndexNumber != null ? <span>S{upNext.ParentIndexNumber}·E{upNext.IndexNumber}</span> : null}
              <strong>{upNext.Name}</strong>
              {upNext.RuntimeMinutes ? <span>· {upNext.RuntimeMinutes} min</span> : null}
            </div> : upNext.RuntimeMinutes ? <div className="player-next-up-line"><span>{upNext.RuntimeMinutes} min</span></div> : null}
            {upNext.Overview && !(hideUnwatchedOverview && upNext.UserData?.Played !== true && (upNext.UserData?.PlaybackPositionTicks ?? 0) <= 0) ? <p className="player-next-up-overview">{upNext.Overview}</p> : null}
            <div className="player-next-up-actions">
              <button autoFocus data-tv-focusable="true" className="tv-button" onClick={() => advanceToNext(0)}>Play Now</button>
              {upNextCountdown ? <span className="player-next-up-count" aria-label={`Playing in ${upNextCountdown.seconds} seconds`}><svg viewBox="0 0 58 58"><circle cx="29" cy="29" r="26" className="track" /><circle cx="29" cy="29" r="26" className="arc" strokeDasharray={2 * Math.PI * 26} strokeDashoffset={2 * Math.PI * 26 * (1 - Math.min(1, Math.max(0, upNextCountdown.seconds / upNextCountdown.total)))} /></svg><b>{upNextCountdown.seconds}</b></span> : null}
            </div>
            {shuffle ? <button data-tv-focusable="true" className="tv-button secondary player-next-up-pick" disabled={shufflePicking} onClick={pickAnotherShuffle}>Pick Another</button> : null}
          </> : <>
            <h2>{upNextCard.videoEnded ? "End of playback" : "Almost finished"}</h2>
            <p className="player-next-up-overview">{shuffle ? "Nothing else in this shuffle can play." : "No next episode is available."}</p>
          </>}
          <div className="player-next-up-actions">
            {!upNextCard.videoEnded ? <button autoFocus={!upNext} data-tv-focusable="true" data-setting="keep" className="tv-button secondary" onClick={keepWatching}>Keep Watching</button> : null}
            <button autoFocus={!upNext && upNextCard.videoEnded} data-tv-focusable="true" data-setting="back" className="tv-button secondary" onClick={exitPlayer}>Back</button>
          </div>
          {shuffleMessage ? <p className="player-next-up-error">{shuffleMessage}</p> : null}
          {upNext ? <div className="player-next-up-toggles">
            <button data-tv-focusable="true" className="player-next-up-toggle" onClick={toggleAutoPlayNext}>Auto-play is {autoPlayNext ? "On" : "Off"}</button>
            {shuffle ? <><span>·</span><button data-tv-focusable="true" className="player-next-up-toggle" onClick={exitPlayer}>Stop shuffling</button></> : null}
          </div> : null}
        </div>
      </div></div>
      {onDeckItems.length ? <div className="player-on-deck"><h3>On Deck</h3><div className="player-on-deck-row">{onDeckItems.map(candidate => <button key={candidate.Id} data-tv-focusable="true" className="player-on-deck-card" onClick={() => { setUpNextCard(null); onPlayNext?.(candidate, 0); }}><span className="player-on-deck-art">{!hidesArt(candidate) && artUrl(session, candidate) ? <img src={artUrl(session, candidate)} alt="" /> : null}</span><strong>{candidate.SeriesName || candidate.Name}</strong><small>{candidate.ParentIndexNumber != null && candidate.IndexNumber != null ? `S${candidate.ParentIndexNumber}·E${candidate.IndexNumber} — ${candidate.Name}` : candidate.ProductionYear ?? ""}</small></button>)}</div></div> : null}
    </section> : null}

    {subtitleSearch && version?.file_id != null ? <SubtitleSearchDialog session={session} mediaFileId={version.file_id} defaultLanguage={subtitleSearch.language} onClose={closeSubtitleSearch} onDownloaded={refreshAfterSubtitleDownload} /> : null}
    {aiDialog && aiStatus && aiStore.current ? <AiTranslateDialog store={aiStore.current.store} status={aiStatus} defaultTargetLanguage={aiDialog.language} onClose={closeAiTranslate}
      subtitleSources={subtitles.filter(track => !/pgs|hdmv|dvd|vobsub|dvb/i.test(track.codec ?? "")).map((track): AiSource => ({ label: `${subtitleName(track)}${track.codec ? ` ${track.codec.toUpperCase()}` : ""}${track.source === "external" ? " (External)" : ""}`, index: track.combined_index, language: track.language ?? "" }))}
      audioSources={audioTracks.map((track, i): AiSource => ({ label: audioTrackDescription(track, i), index: track.index ?? i, language: track.language ?? "" }))} /> : null}
    {panel ? <section className="player-options" data-modal="true" aria-label="Player options">
      <nav className="player-hud-tabs" aria-label="Player information tabs">
        {hudTabs.map(tab => <button key={tab} data-tv-focusable="true" data-hud-tab={tab} className={`player-hud-tab ${hudTab === tab ? "selected" : ""}`} onFocus={() => setHudTab(tab)} onClick={() => setHudTab(tab)}>{tab}</button>)}
      </nav>
      <div className="player-hud-card" data-hud-pane={hudTab}>
        {hudTab === "Info" ? <div className="player-hud-columns">
          <div><div className="player-hud-eyebrow">Title</div>{item.Type === "Episode" ? <small className="player-hud-episode">{detail?.season_number != null && detail.episode_number != null ? `S${detail.season_number} · E${detail.episode_number}` : "Episode"}</small> : null}<h2>{detail?.title ?? item.Name}</h2>{duration > 0 ? <p>{formatClock(duration)}</p> : null}{version?.resolution ? <span className="player-hud-chip">{version.resolution}</span> : null}</div>
          <div><div className="player-hud-eyebrow">Stream</div><div className="player-hud-readonly"><span>Video</span><strong>{version?.codec_video?.toUpperCase() || "—"}</strong></div><div className="player-hud-readonly"><span>Audio</span><strong>{version?.codec_audio?.toUpperCase() || "—"}</strong></div><div className="player-hud-readonly"><span>Subtitles</span><strong>{subtitleValue || "Off"}</strong></div>{version?.container ? <div className="player-hud-readonly"><span>Container</span><strong>{version.container.toUpperCase()}</strong></div> : null}</div>
        </div> : null}
        {hudTab === "Stats" ? <div className="player-hud-columns">
          <div><div className="player-hud-eyebrow">Delivery</div>
            <div className="player-hud-readonly"><span>Route</span><strong>{plan?.delivery || "—"}</strong></div>
            <div className="player-hud-readonly"><span>Protocol</span><strong>{plan?.stream.protocol?.toUpperCase() || "—"}</strong></div>
            {plan?.stream.container ? <div className="player-hud-readonly"><span>Container</span><strong>{plan.stream.container.toUpperCase()}</strong></div> : null}
          </div>
          <div><div className="player-hud-eyebrow">Playback</div>
            {playerStats.resolution ? <div className="player-hud-readonly"><span>Resolution</span><strong>{playerStats.resolution}</strong></div> : null}
            {typeof playerStats.totalFrames === "number" ? <div className="player-hud-readonly"><span>Decoded frames</span><strong>{playerStats.totalFrames.toLocaleString()}</strong></div> : null}
            {(playerStats.droppedFrames ?? 0) > 0 ? <div className="player-hud-readonly"><span>Dropped frames</span><strong>{playerStats.droppedFrames!.toLocaleString()}</strong></div> : null}
            <div className="player-hud-readonly"><span>Playback speed</span><strong>{playbackSpeed === 1 ? "Normal" : `${playbackSpeed}×`}</strong></div>
          </div>
        </div> : null}
        {hudTab === "Video" ? <div className="player-hud-video-grid">
          <div><div className="player-hud-eyebrow">Playback</div>
            {detail && detail.versions.length > 1 ? <button data-tv-focusable="true" data-hud-row="version" className="option-row" onClick={() => presentHudPicker("Version", detail.versions.map(file => ({ label: versionLabel(file), value: String(file.file_id) })), String(version?.file_id ?? ""), "version", value => { const selected = detail.versions.find(file => String(file.file_id) === value); if (selected) void selectFileVersion(selected); })}><span>Version</span><small>{version ? versionLabel(version) : "Auto"}</small></button> : null}
            {qualities.length ? <button data-tv-focusable="true" data-hud-row="quality" className="option-row" onClick={() => presentHudPicker("Quality", [{ label: "Auto", value: "auto" }, ...qualities.map(quality => ({ label: quality.preserves_source ? `Original${quality.height ? ` · ${quality.height}p` : version?.resolution ? ` · ${version.resolution}` : ""}` : quality.label, value: quality.label }))], qualityRef.current, "quality", value => selectQuality({ label: value }))}><span>Quality</span><small>{qualityRef.current === "auto" ? "Auto" : qualityRef.current}</small></button> : null}
            <button data-tv-focusable="true" data-hud-row="speed" className="option-row" onClick={() => presentHudPicker("Playback speed", [0.75, 1, 1.25, 1.5, 2].map(value => ({ label: value === 1 ? "Normal" : `${value}×`, value: String(value) })), String(playbackSpeed), "speed", value => setPlaybackSpeed(Number(value)))}><span>Speed</span><small>{playbackSpeed === 1 ? "Normal" : `${playbackSpeed}×`}</small></button>
            <button data-tv-focusable="true" data-hud-row="aspect" className="option-row" onClick={() => presentHudPicker("Aspect", [{ label: "Letterbox", value: "Fit" }, { label: "Zoom (crop)", value: "Zoom" }, { label: "Stretch", value: "Stretch" }], aspectMode, "aspect", value => setAspectMode(value as typeof aspectMode))}><span>Aspect</span><small>{aspectLabel(aspectMode)}</small></button>
          </div>
          <div><div className="player-hud-eyebrow">Output</div>
            <button data-tv-focusable="true" data-hud-row="hdr" className="option-row" onClick={() => { const next = !hdrOn; setHdrOn(next); setLocalHdrEnabled(next); }}><span>HDR passthrough</span><small>{hdrOn ? "On" : "Off"}</small></button>
            <button data-tv-focusable="true" data-hud-row="dolby-vision" className="option-row" onClick={() => void toggleDolbyVision()}><span>Dolby Vision</span><small>{dolbyApplying ? `${dolbyOn ? "On" : "Off"} · Applying...` : dolbyOn ? "On" : "Off"}</small></button>
            <div className="player-hud-eyebrow">Automation</div>
            <button data-tv-focusable="true" data-hud-row="intro-skip" className="option-row" onClick={() => presentHudPicker("Skip Intros", [{ label: "Never", value: "never" }, { label: "Ask to skip", value: "ask" }, { label: "Skip automatically", value: "always" }], introSkipMode, "intro-skip", value => { setIntroSkipMode(value as typeof introSkipMode); void putScopedSetting(session, "playback.intro_skip_mode", "profile_device", value).catch(() => undefined); })}><span>Skip intros</span><small>{{ never: "Never", ask: "Ask to skip", always: "Skip automatically" }[introSkipMode]}</small></button>
            <button data-tv-focusable="true" data-hud-row="auto-play" className="option-row" onClick={toggleAutoPlayNext}><span>Auto-play next</span><small>{autoPlayNext ? "On" : "Off"}</small></button>
            <button data-tv-focusable="true" data-hud-row="sleep-timer" className="option-row" onClick={() => presentHudPicker("Sleep timer", [...(sleepDeadline != null ? [{ label: "Cancel timer", value: "cancel" }] : []), { label: "Off", value: "off" }, ...[15, 30, 45, 60, 90].map(minutes => ({ label: minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`, value: String(minutes) }))], sleepDeadline != null ? "cancel" : "off", "sleep-timer", value => {
              if (value === "cancel" || value === "off") setSleepDeadline(null);
              else { const minutes = Number(value); if ([15, 30, 45, 60, 90].includes(minutes)) setSleepDeadline(Date.now() + minutes * 60_000); }
            })}><span>Sleep timer</span><small>{sleepRemaining == null ? "Off" : `Sleeping in ${Math.floor(sleepRemaining / 60)}m ${sleepRemaining % 60}s`}</small></button>
          </div>
        </div> : null}
        {hudTab === "Audio" ? <div className="player-hud-columns">
          <div><div className="player-hud-eyebrow">Track</div>
            {audioTracks.length > 1 ? <button data-tv-focusable="true" data-hud-row="audio-track" className="option-row" onClick={() => presentHudPicker("Audio track", audioTracks.map((track, i) => ({ label: audioTrackDescription(track, i), value: String(track.index ?? i) })), String(selectedAudioTrack?.index ?? audioTracks.indexOf(selectedAudioTrack!)), "audio-track", value => { const selectedIndex = Number(value); const chosen = audioTracks.find((track, i) => (track.index ?? i) === selectedIndex); if (chosen) selectAudio(chosen, selectedIndex); })}><span>Audio track</span><small>{audioTrackDescription(selectedAudioTrack, audioTracks.indexOf(selectedAudioTrack))}</small></button> : <div className="player-hud-readonly"><span>Audio track</span><strong>{audioTrackDescription(selectedAudioTrack, audioTracks.indexOf(selectedAudioTrack))}</strong></div>}
            <button data-tv-focusable="true" data-hud-row="audio-delay" className="option-row" disabled={!audioDelaySupported()} onClick={() => presentHudPicker("Audio delay", delayChoices(0, 1000, 50), String(audioDelayMs), "audio-delay", value => changeAudioDelay(Number(value)))}><span>Delay (PCM only)</span><small>{audioDelaySupported() ? delayLabel(audioDelayMs) : "Unavailable"}</small></button>
            <p className="player-hud-note">Track changes are negotiated by Silo for this playback session.</p>
          </div>
          <div><div className="player-hud-eyebrow">Output</div>
            <div className="player-hud-readonly"><span>Codec</span><strong>{selectedAudioTrack?.codec?.toUpperCase() || version?.codec_audio?.toUpperCase() || "—"}</strong></div>
            <div className="player-hud-readonly"><span>Mode</span><strong>Browser managed</strong></div>
            <div className="player-hud-readonly"><span>Delivery</span><strong>{plan?.stream.protocol?.toUpperCase() || "—"}</strong></div>
            <div className="player-hud-readonly"><span>Container</span><strong>{plan?.stream.container?.toUpperCase() || version?.container?.toUpperCase() || "—"}</strong></div>
          </div>
        </div> : null}
        {hudTab === "Subtitles" ? <div className="player-hud-list"><div className="player-hud-eyebrow">Subtitles</div>{!styleView ? <><button data-tv-focusable="true" data-hud-row={!activeSubtitle ? "subtitle-track" : undefined} className="option-row" onClick={() => selectSubtitle()}><span>Off</span>{!activeSubtitle ? <small>Current</small> : null}</button>{subtitles.map(track => <button data-tv-focusable="true" data-hud-row={activeSubtitle?.track_id === track.track_id ? "subtitle-track" : undefined} className="option-row" key={track.track_id} onClick={() => selectSubtitle(track)}><span>{subtitleName(track)}</span><small>{activeSubtitle?.track_id === track.track_id ? "Current" : subtitleDetail(track)}</small></button>)}{appearance ? <button data-tv-focusable="true" data-style-entry className="option-row" onClick={() => setStyleView("list")}><span>Appearance</span><small>{subtitleChoiceLabel("fontSize", appearance.fontSize)} · {subtitleChoiceLabel("position", appearance.position)}</small></button> : null}<button data-tv-focusable="true" data-timing-entry className="option-row" disabled={!hasSidecarSubtitle && !timingActions} onClick={() => { setStyleView("timing"); requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-timing-first]")?.focus()); }}><span>Timing</span><small>{timingActions && (timingActions.busy || timingActions.inProgress) ? "Working..." : hasSidecarSubtitle ? delaySecondsLabel(subtitleDelayMs) : timingActions ? timingValue(timingActions) : "Unavailable"}</small></button>{version?.file_id != null ? <><div className="player-hud-eyebrow">Find more</div><button data-tv-focusable="true" data-hud-row="subtitle-search" className="option-row" onClick={() => void openSubtitleSearch()}><span>Search online</span></button>{aiStatus && (aiStatus.enabled || aiStatus.transcribe_enabled) ? <button data-tv-focusable="true" data-hud-row="subtitle-ai" className="option-row" onClick={() => void openAiTranslate()}><span>Translate with AI</span></button> : null}</> : null}</> : styleView === "timing" ? <><div className="player-hud-eyebrow">Timing</div><button data-tv-focusable="true" data-timing-first={hasSidecarSubtitle ? "" : undefined} data-hud-row="subtitle-delay" className="option-row" disabled={!hasSidecarSubtitle} onClick={() => presentHudPicker("Subtitle delay", delayChoices(-2000, 2000, 100), String(subtitleDelayMs), "subtitle-delay", value => changeSubtitleDelay(Number(value)))}><span>Delay</span><small>{hasSidecarSubtitle ? delayLabel(subtitleDelayMs) : "Unavailable for burned-in subtitles"}</small></button>{timingActions ? <>
          <button data-tv-focusable="true" data-timing-first={hasSidecarSubtitle ? undefined : ""} data-hud-row="subtitle-sync" className="option-row" onClick={() => { if (!timingActions.forbidden && !timingActions.busy && !timingActions.inProgress && timingActions.canSync) void syncStore.current?.requestSync(timingActions.key); }}><span>Sync to audio</span><small>{timingValue(timingActions)}</small></button>
          {timingActions.canReset ? <button data-tv-focusable="true" data-hud-row="subtitle-reset" className="option-row" onClick={() => { if (!timingActions.forbidden && !timingActions.busy && !timingActions.inProgress) void syncStore.current?.resetTiming(timingActions.key); }}><span>Reset timing</span></button> : null}
          {timingActions.inProgress && timingActions.percent != null ? <div className="player-hud-sync"><div className="ai-translate-bar"><div style={{ width: `${timingActions.percent}%` }} /></div>{timingActions.phaseLabel ? <p className="player-hud-note">{timingActions.phaseLabel}</p> : null}</div> : null}
          {(() => { const text = timingActions.forbidden ? FORBIDDEN_MESSAGE : timingActions.error ?? timingActions.result?.text ?? timingActions.note; const color = timingActions.forbidden ? undefined : timingActions.error ? "#FCA5A5" : timingActions.result?.warning ? "#FDE68A" : undefined; return text ? <p className="player-hud-note" style={color ? { color } : undefined}>{text}</p> : null; })()}
        </> : null}</> : appearance && styleView === "list" ? <>{SUBTITLE_APPEARANCE_FIELDS.map(([key, label], i) => <button key={key} data-tv-focusable="true" data-style-key={key} className="option-row" onClick={() => setStyleView(key)}><span>{label}</span><small>{subtitleChoiceLabel(key, appearance[key])}</small></button>)}<div className="subtitle-settings-preview" style={{ color: appearance.fontColor, opacity: appearance.textOpacity / 100, fontFamily: appearance.fontFamily }}>Subtitle preview</div></> : appearance && styleView && styleView !== "list" ? SUBTITLE_APPEARANCE_CHOICES[styleView].map(choice => <button key={String(choice.value)} data-tv-focusable="true" className="option-row" onClick={() => changeAppearance(styleView, choice.value)}><span>{choice.label}</span>{choice.value === appearance[styleView] ? <small>Current</small> : null}</button>) : null}</div> : null}
        {hudTab === "Chapters" ? <div className="player-hud-list"><div className="player-hud-eyebrow">Chapters</div>{chapters.map((chapter, i) => <button data-tv-focusable="true" className="option-row" key={`${chapter.index}-${chapter.start_seconds}`} onClick={() => { seekToPosition(chapter.start_seconds); setPanel(null); revealHud(); }}><span>{chapter.title || `Chapter ${i + 1}`}</span><small>{formatClock(chapter.start_seconds)}</small></button>)}</div> : null}
      </div>
      {hudPicker ? <div className="player-hud-picker-scrim" onClick={event => { if (event.target === event.currentTarget) { setHudPicker(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-hud-row="${hudPicker.returnKey}"]`)?.focus()); } }}><section className="player-hud-picker" role="dialog" aria-label={hudPicker.title}><h2>{hudPicker.title}</h2><div className="player-hud-picker-hint">Choose an option</div>{hudPicker.choices.map(choice => <button key={choice.value} data-tv-focusable="true" data-picker-value={choice.value} className={`option-row ${choice.value === hudPicker.selected ? "selected" : ""}`} onClick={() => chooseHudPicker(choice.value)}><span>{choice.label}</span>{choice.value === hudPicker.selected ? <small>✓</small> : null}</button>)}</section></div> : null}
    </section> : null}
  </main>;
}

/** Sheet URLs resolve against the manifest path they were read from, like TrickplayManifest.from. */
function sheetUrl(session: Session, itemId: string, url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  const root = session.serverUrl.replace(/\/+$/, "");
  if (url.startsWith("/")) return `${root}${url}`;
  return `${root}/api/v2/watch/${encodeURIComponent(itemId)}/trickplay/${url}`;
}
