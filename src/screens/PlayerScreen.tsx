import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { bestVersionForDevice, getMarkers, getTrickplay, getWatchDetail, playbackUrl, replanPlaybackV3, reportProgress, saveAudioPreference, saveSubtitlePreference, startPlaybackV3, stopPlayback, stopPlaybackKeepalive, type AudioTrack, type FileMarkers, type MarkerSegment, type PlaybackChoices, type PlaybackPlan, type Quality, type SubtitleInventory, type Trickplay, type WatchDetail } from "../api/playback";
import type { Session, SiloItem } from "../types";
import { getEffectiveSettings, putScopedSetting } from "../api/settings";
import { artUrl, getHomeRails, getShuffle, skipShuffle } from "../api/silo";
import { parseSubtitleAppearance, SUBTITLE_APPEARANCE_CHOICES, SUBTITLE_APPEARANCE_FIELDS, subtitleChoiceLabel, subtitleCueCss } from "../core/subtitleStyle";
import { putDeviceSubtitleAppearance, putProfileSubtitleAppearance, type SubtitleAppearance } from "../api/settings";
import { attachSidecarSubtitle } from "../core/subtitleSidecar";
import { localPassOutThreshold, localResumeRewindSeconds, markerAction, resumePositionWithRewind } from "../core/playerSettings";

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
const SKIP_BACK_SECONDS = 10;
const SKIP_FORWARD_SECONDS = 30;
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

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

type PillKind = "intro" | "credits" | "recap";
type Pill = { kind: PillKind; key: string; label: string; secondsRemaining: number | null; undo?: boolean };
type UiSnapshot = { upNextOpen: boolean; hud: boolean; panel: "audio" | "subtitles" | "quality" | null; scrubPreview: number | null; autoSeekRate: number; cleanSeek: { rate: number; preview: number } | null; pill: Pill | null; position: number; duration: number; playing: boolean };

/** The player's transport glyphs: dark-disc buttons inverting to Paper on focus. */
function TransportGlyph({ name }: { name: "play" | "pause" | "back10" | "forward30" | "subtitles" | "tune" | "close" }) {
  const arc = (forward: boolean, seconds: number) => <g>
    <path d={forward ? "M12 4a8 8 0 1 1-7.4 4.9" : "M12 4a8 8 0 1 0 7.4 4.9"} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    <path d={forward ? "M3.2 6.4 4.9 9.2 7.8 7.9" : "M20.8 6.4 19.1 9.2 16.2 7.9"} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    <text x="12" y="15.6" textAnchor="middle" fontSize="7.6" fontWeight="700" fill="currentColor" stroke="none" fontFamily="inherit">{seconds}</text>
  </g>;
  switch (name) {
    case "play": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 5.6v12.8c0 .9 1 1.4 1.7.9l9-6.4c.6-.4.6-1.4 0-1.8l-9-6.4c-.7-.5-1.7 0-1.7.9z" fill="currentColor" /></svg>;
    case "pause": return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.4" y="5" width="3.9" height="14" rx="1.3" fill="currentColor" /><rect x="13.7" y="5" width="3.9" height="14" rx="1.3" fill="currentColor" /></svg>;
    case "back10": return <svg viewBox="0 0 24 24" aria-hidden="true">{arc(false, SKIP_BACK_SECONDS)}</svg>;
    case "forward30": return <svg viewBox="0 0 24 24" aria-hidden="true">{arc(true, SKIP_FORWARD_SECONDS)}</svg>;
    case "subtitles": return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.4" y="4.8" width="17.2" height="14.4" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M6.6 14.6h6.2M15.2 14.6h2.4M6.6 10.4h2.2M11 10.4h6.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
    case "tune": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h9m4 0h3M4 16h3m4 0h9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><circle cx="15" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.9" /><circle cx="9" cy="16" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>;
    case "close": return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg>;
  }
}

export function PlayerScreen({ session, item, startPosition, choices, onBack, onEnded, resolveNextEpisode, onPlayNext, shuffle, onShuffleAdvance, autoAdvanceCount = 0 }: { session: Session; item: SiloItem; startPosition?: number; choices?: PlaybackChoices; onBack: (elapsedSeconds: number) => void; onEnded?: () => void; resolveNextEpisode?: () => Promise<SiloItem | null>; onPlayNext?: (next: SiloItem, autoAdvanceCount: number) => void; shuffle?: { id: string; scopeLabel?: string; next?: SiloItem }; onShuffleAdvance?: (autoAdvanceCount: number) => void; autoAdvanceCount?: number }) {
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
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);
  const [bufferedAhead, setBufferedAhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

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
  const [subtitleCss, setSubtitleCss] = useState("");
  const [appearance, setAppearance] = useState<SubtitleAppearance | null>(null);
  const [appearanceDeviceOnly, setAppearanceDeviceOnly] = useState(false);
  const [styleView, setStyleView] = useState<null | "list" | keyof SubtitleAppearance>(null);
  const styleViewRef = useRef(styleView);
  styleViewRef.current = styleView;
  useEffect(() => { if (!panel) setStyleView(null); }, [panel]);
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
  const ui = useRef<UiSnapshot>({ upNextOpen: false, hud: true, panel: null, scrubPreview: null, autoSeekRate: 0, cleanSeek: null, pill: null, position: 0, duration: 0, playing: false });
  ui.current = { upNextOpen: upNextCard != null, hud, panel, scrubPreview, autoSeekRate, cleanSeek, pill, position, duration, playing };

  const sourcePosition = useCallback(() => {
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
    void attachSidecarSubtitle(video, next.plan, session, sidecarHeaders, sidecarTrack.current).then(track => { sidecarTrack.current = track; }).catch(() => undefined);
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
      getEffectiveSettings(session, ["playback.intro_skip_mode", "playback.auto_skip_credits", "playback.auto_play_next", "playback.subtitle_appearance", "catalog.hide_unwatched_episode_overviews", "catalog.hide_unwatched_episode_images"]).catch(() => new Map()),
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
      setHideUnwatchedOverview(settings.get("catalog.hide_unwatched_episode_overviews")?.value === true);
      setHideUnwatchedImages(settings.get("catalog.hide_unwatched_episode_images")?.value === true);
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
    if (focus === "transport") transportRef.current?.querySelector<HTMLElement>("button")?.focus();
    if (focus === "scrubber") scrubberRef.current?.focus();
  }, []);

  const focusTransport = useCallback(() => {
    const current = document.activeElement;
    if (current instanceof HTMLElement && transportRef.current?.contains(current)) return;
    transportRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  /** Seek the negotiated stream to a source-timeline position (re-anchors when the server demands it). */
  const seekToPosition = useCallback((target: number) => {
    const video = videoRef.current;
    const active = stateRef.current;
    if (!video || !active) return;
    const offset = active.plan.timeline.timeline_offset_seconds;
    const localTarget = target - offset;
    if (localTarget < 0 || !active.plan.timeline.can_seek_anywhere) {
      setBusy(true);
      void replanPlaybackV3(session, active, "seek_reanchor", target, qualityRef.current, active.plan.selected_tracks)
        .then(installPlan)
        .catch(reason => setError(reason instanceof Error ? reason.message : "Silo could not seek to that position."))
        .finally(() => setBusy(false));
    } else {
      video.currentTime = Math.max(0, localTarget);
    }
    setPosition(target);
  }, [installPlan, session]);

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

  function selectPill() {
    const current = ui.current.pill;
    if (!current || !markers) return;
    const segment = markers[current.kind];
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
      setPanel(null);
      revealHud();
      focusTransport();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Silo could not change playback."); }
    finally { setBusy(false); }
  }

  function selectAudio(track: AudioTrack) {
    if (track.index == null || !version) return;
    if (detail?.series_id) void saveAudioPreference(session, detail.series_id, track).catch(console.error);
    void replan("track_change", qualityRef.current, { id: `file:${version.file_id}:audio:${track.index}`, index: track.index }, plan?.selected_tracks.subtitle);
  }
  function selectSubtitle(track?: SubtitleInventory) {
    if (detail?.series_id) void saveSubtitlePreference(session, detail.series_id, track).catch(console.error);
    void replan("track_change", qualityRef.current, plan?.selected_tracks.audio, track ? { id: track.track_id, index: track.combined_index } : undefined);
  }
  function selectQuality(quality: Quality | { label: string }) {
    void replan("quality_change", quality.label, plan?.selected_tracks.audio, plan?.selected_tracks.subtitle);
  }

  function togglePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  /** Panels hold the chrome steady: opening one disarms the auto-hide. */
  function openPanel(name: "audio" | "subtitles" | "quality") {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    setPanel(name);
  }

  function changeAppearance(key: keyof SubtitleAppearance, value: unknown) {
    if (!appearance) return;
    const next = { ...appearance, [key]: value } as SubtitleAppearance;
    setAppearance(next);
    setSubtitleCss(subtitleCueCss(next));
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
          next?.focus();
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
      if (snapshot.panel) {
        if (isBackKey(event) && styleViewRef.current) {
          event.preventDefault(); event.stopPropagation();
          const field = styleViewRef.current;
          setStyleView(field === "list" ? null : "list");
          requestAnimationFrame(() => document.querySelector<HTMLElement>(field === "list" ? "[data-style-entry]" : `[data-style-key='${field}']`)?.focus());
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
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) return;
          const rows = Array.from(document.querySelectorAll<HTMLElement>(".player-options [data-tv-focusable='true']")).filter(row => row.offsetParent !== null);
          const index = rows.indexOf(document.activeElement as HTMLElement);
          const next = rows[event.key === "ArrowDown" ? index + 1 : index - 1];
          if (next) next.focus();
          return;
        }
        if (event.key === "Enter" || event.key === "OK" || event.key === " ") {
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) (document.activeElement as HTMLElement | null)?.click();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); event.stopPropagation();
          return;
        }
        return;
      }

      // Any key activity re-arms the auto-hide while the overlay is up.
      if (snapshot.hud) revealHud();

      // Dedicated transport seek keys skip in every surface state.
      if (event.key === "MediaRewind" || event.key === "MediaTrackPrevious") {
        event.preventDefault(); event.stopPropagation();
        stopCleanSeek();
        performRelativeSeek(-SKIP_BACK_SECONDS, true);
        return;
      }
      if (event.key === "MediaFastForward" || event.key === "MediaTrackNext") {
        event.preventDefault(); event.stopPropagation();
        stopCleanSeek();
        performRelativeSeek(SKIP_FORWARD_SECONDS, true);
        return;
      }
      if (/^Media(Pause|Play|PlayPause)$/.test(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) {
          if (snapshot.cleanSeek) commitCleanSeek();
          else togglePlayPause();
        }
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
        else if (onTransportButton || onPill) { /* bottom row: stay */ }
        else if (snapshot.cleanSeek) stopCleanSeek();
        else revealHud("transport");
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        if (onTransportButton) scrubberRef.current?.focus();
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
          else performRelativeSeek(direction < 0 ? -SKIP_BACK_SECONDS : SKIP_FORWARD_SECONDS, true);
          return;
        }
        if (document.activeElement === scrubberRef.current) {
          event.preventDefault(); event.stopPropagation();
          if (pendingTapDirection.current === direction) {
            pendingTapDirection.current = 0;
            if (ui.current.autoSeekRate !== 0) {
              setAutoSeekRate(rate => bumpedRate(rate, direction));
            } else if (ui.current.scrubPreview != null) {
              const step = direction < 0 ? -SKIP_BACK_SECONDS : SKIP_FORWARD_SECONDS;
              setScrubPreview(current => clampSeek((current ?? 0) + step, ui.current.duration));
            } else {
              const delta = direction < 0 ? -SKIP_BACK_SECONDS : SKIP_FORWARD_SECONDS;
              const target = clampSeek(ui.current.position + delta, ui.current.duration);
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
  const subtitles = plan?.subtitle.inventory ?? [];
  const qualities = plan?.available_qualities ?? [];
  const chapters = version?.chapters ?? [];
  const labelSeconds = scrubPreview ?? position;
  const remaining = Math.max(0, duration - labelSeconds);
  const endsAt = remaining > 0 ? new Date(Date.now() + remaining * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const playedFraction = duration > 0 ? Math.max(0, Math.min(1, labelSeconds / duration)) : 0;
  const bufferedFraction = duration > 0 ? Math.max(0, Math.min(1, (position + bufferedAhead) / duration)) : 0;
  const selectedSubtitle = plan?.selected_tracks.subtitle;
  const activeSubtitle = selectedSubtitle ? subtitles.find(track => track.track_id === selectedSubtitle.id) : null;
  const subtitleValue = activeSubtitle ? subtitleName(activeSubtitle) : "Off";
  const previewCard = tileBackground(160, 90);
  const holdCard = cleanSeek ? tileBackground(240, 135) : null;
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
    <video ref={videoRef} className={upNextRect ? "player player-in-next-up" : "player"} style={upNextRect ? { left: upNextRect.left, top: upNextRect.top, width: upNextRect.width, height: upNextRect.height } : undefined} playsInline
      onPlay={() => { setPlaying(true); revealHud(); }}
      onPause={() => { setPlaying(false); revealHud(); }}
      onEnded={handleMediaEnded}
      onTimeUpdate={event => {
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

        <div ref={scrubberRef} className="player-scrubber" tabIndex={-1} data-active={scrubberFocused || scrubPreview != null}
          onFocus={() => setScrubberFocused(true)} onBlur={() => setScrubberFocused(false)}>
          {previewSeconds != null && (previewCard || autoSeekRate !== 0) ? <div className="scrub-preview-stack" data-fast={autoSeekRate !== 0} style={{ left: `clamp(84px, ${playedFraction * 100}%, calc(100% - 84px))` }}>
            {previewCard ? <div className="scrub-preview-card">
              <div className="trickplay-frame" style={previewCard} />
              <span className="scrub-preview-time">{formatClock(previewSeconds)}</span>
            </div> : null}
            {autoSeekRate !== 0 ? <div className="auto-seek-chip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={autoSeekRate < 0 ? "M20.8 6.4 19.1 9.2 16.2 7.9" : "M3.2 6.4 4.9 9.2 7.8 7.9"} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><path d={autoSeekRate < 0 ? "M12 4a8 8 0 1 0 7.4 4.9" : "M12 4a8 8 0 1 1-7.4 4.9"} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>{Math.abs(autoSeekRate)}x</div> : null}
          </div> : null}
          <div ref={timelineRef} className="scrub-bar" role="slider" aria-label="Playback position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(labelSeconds)} tabIndex={-1}>
            {segments.map(([start, end], index) => {
              const span = end - start;
              if (span <= 0) return null;
              const local = (fraction: number) => Math.max(0, Math.min(1, (fraction - start) / span));
              const innerLeft = index === 0 ? 0 : 1;
              const innerRight = index === segments.length - 1 ? 0 : 1;
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
            <button className="transport-button" onClick={() => performRelativeSeek(-SKIP_BACK_SECONDS, true)} aria-label={`Skip back ${SKIP_BACK_SECONDS} seconds`}><TransportGlyph name="back10" /></button>
            <button className="transport-button primary" onClick={togglePlayPause} aria-label={playing ? "Pause" : "Play"}><TransportGlyph name={playing ? "pause" : "play"} /></button>
            <button className="transport-button" onClick={() => performRelativeSeek(SKIP_FORWARD_SECONDS, true)} aria-label={`Skip forward ${SKIP_FORWARD_SECONDS} seconds`}><TransportGlyph name="forward30" /></button>
          </div>
          <div className="transport-group">
            <button className="transport-button labeled" onClick={() => openPanel("subtitles")} aria-label={`Subtitles · ${subtitleValue}`}><TransportGlyph name="subtitles" /><span>Subtitles</span><small>{subtitleValue}</small></button>
            <button className="transport-button labeled" onClick={() => openPanel("quality")} aria-label="Options" disabled={!qualities.length}><TransportGlyph name="tune" /><span>Options</span></button>
            <button className="transport-button labeled" onClick={exitPlayer} aria-label="Close player"><TransportGlyph name="close" /><span>Close</span></button>
          </div>
        </div>
      </div>

      {pill ? <div ref={pillRef} className="skip-pill" tabIndex={-1} onClick={selectPill} data-prompt={pill.kind}>
        {pillFill != null ? <b className="skip-pill-fill" style={{ width: `${Math.max(0, Math.min(1, pillFill)) * 100}%` }} /> : null}
        {pill.undo ? <small className="skip-pill-caption">Intro skipped</small> : null}
        <span>{pill.label}</span>
      </div> : null}

      {cleanSeek ? <div className="hold-seek-indicator">
        <div className="hold-seek-frame" style={holdCard ?? { background: "rgba(0,0,0,.42)" }} />
        <div className="hold-seek-chip"><strong>{cleanSeek.rate < 0 ? "−" : ""}{Math.abs(cleanSeek.rate)}×</strong><span>{formatClock(cleanSeek.preview)}</span></div>
        {duration > 0 ? <div className="hold-seek-track"><b style={{ width: `${Math.max(0, Math.min(1, cleanSeek.preview / duration)) * 100}%` }} /></div> : null}
        <div className="hold-seek-hint">← → speed · ◉ play · ↩ cancel</div>
      </div> : null}

      {skipFeedback && !cleanSeek ? <div className="skip-feedback" data-nonce={skipFeedback.nonce}>
        <div className="skip-feedback-chip"><strong>{skipFeedback.delta < 0 ? `−${-skipFeedback.delta}s` : `+${skipFeedback.delta}s`}</strong><span>{formatClock(skipFeedback.target)}</span></div>
        {!hud && duration > 0 ? <div className="skip-feedback-track"><b style={{ width: `${Math.max(0, Math.min(1, skipFeedback.target / duration)) * 100}%` }} /></div> : null}
      </div> : null}

      {busy ? <div className="player-status">Asking Silo for the best playback route...</div> : null}
      {error ? <div className="player-error">{error}</div> : null}
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

    {panel ? <section className="player-options" data-modal="true">
      <div className="eyebrow">Playback</div>
      <h2>{panel === "audio" ? "Audio" : panel === "subtitles" ? (styleView ? "Subtitle appearance" : "Subtitles") : "Quality"}</h2>
      {panel === "audio" && audioTracks.map((track, i) => <button autoFocus={i === 0} data-tv-focusable="true" className="option-row" key={track.index ?? i} onClick={() => selectAudio(track)}><span>{track.title || track.language || `Track ${i + 1}`}</span><small>{[track.codec?.toUpperCase(), track.channels ? `${track.channels} ch` : ""].filter(Boolean).join(" · ")}</small></button>)}
      {panel === "subtitles" && !styleView ? <><button autoFocus data-tv-focusable="true" className="option-row" onClick={() => selectSubtitle()}><span>Off</span></button>{subtitles.map(track => <button data-tv-focusable="true" className="option-row" key={track.track_id} onClick={() => selectSubtitle(track)}><span>{subtitleName(track)}</span><small>{subtitleDetail(track)}</small></button>)}{appearance ? <button data-tv-focusable="true" data-style-entry className="option-row" onClick={() => setStyleView("list")}><span>Appearance</span><small>{subtitleChoiceLabel("fontSize", appearance.fontSize)} · {subtitleChoiceLabel("position", appearance.position)}</small></button> : null}</> : null}
      {panel === "subtitles" && appearance && styleView === "list" ? <>{SUBTITLE_APPEARANCE_FIELDS.map(([key, label], i) => <button autoFocus={i === 0} key={key} data-tv-focusable="true" data-style-key={key} className="option-row" onClick={() => setStyleView(key)}><span>{label}</span><small>{subtitleChoiceLabel(key, appearance[key])}</small></button>)}<div className="subtitle-settings-preview" style={{ color: appearance.fontColor, opacity: appearance.textOpacity / 100, fontFamily: appearance.fontFamily }}>Subtitle preview</div></> : null}
      {panel === "subtitles" && appearance && styleView && styleView !== "list" ? SUBTITLE_APPEARANCE_CHOICES[styleView].map(choice => <button autoFocus={choice.value === appearance[styleView]} key={String(choice.value)} data-tv-focusable="true" className="option-row" onClick={() => changeAppearance(styleView, choice.value)}><span>{choice.label}</span>{choice.value === appearance[styleView] ? <small>Current</small> : null}</button>) : null}
      {panel === "quality" && qualities.map((quality, i) => <button autoFocus={i === 0} data-tv-focusable="true" className="option-row" key={quality.label} onClick={() => selectQuality(quality)}><span>{quality.preserves_source ? `Original${quality.height ? ` · ${quality.height}p` : version?.resolution ? ` · ${version.resolution}` : ""}` : quality.label}</span><small>{quality.bitrate_kbps ? `${Math.round(quality.bitrate_kbps / 100) / 10} Mbps` : ""}</small></button>)}
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
