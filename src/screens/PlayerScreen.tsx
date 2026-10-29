import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { bestVersionForDevice, getWatchDetail, playbackUrl, replanPlaybackV3, reportProgress, saveAudioPreference, saveSubtitlePreference, startPlaybackV3, stopPlayback, stopPlaybackKeepalive, type AudioTrack, type PlaybackPlan, type Quality, type SubtitleInventory, type WatchDetail } from "../api/playback";
import type { Session, SiloItem } from "../types";

type PlaybackState = { plan: PlaybackPlan; playbackAttemptId: string; planAttemptId: string; attemptedKeys: string[] };
const ACTIVE_PLAYBACK_KEY = "silo-webos-active-playback-v1";

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

export function PlayerScreen({ session, item, startPosition, onBack, onEnded }: { session: Session; item: SiloItem; startPosition?: number; onBack: () => void; onEnded?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const closedSessions = useRef(new Set<string>());
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
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const scrubTimer = useRef<number | undefined>(undefined);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragWasPlaying = useRef(false);

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
    if (isHls && !nativeHls) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${session.accessToken}`,
        ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
        ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {}),
        ...(next.plan.stream.headers ?? {})
      };
      void import("hls.js").then(({ default: HlsPlayer }) => {
        if (!HlsPlayer.isSupported() || stateRef.current?.plan.plan_id !== next.plan.plan_id) {
          if (!HlsPlayer.isSupported()) setError("This browser cannot play the negotiated HLS stream.");
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
    getWatchDetail(session, item).then(async (watch) => {
      if (!alive) return;
      const selectedVersion = bestVersionForDevice(watch.versions);
      if (!selectedVersion) throw new Error("Silo did not return a playable media file.");
      setDetail(watch);
      setVersion(selectedVersion);
      const started = await startPlaybackV3(session, watch, selectedVersion, "auto", selectedVersion.effective_audio_track_index, undefined, startPosition);
      if (!alive) { void stopPlayback(session, started.plan.session_id); return; }
      installPlan({ ...started, attemptedKeys: [] });
    }).catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Playback failed."))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
      closePlayback(false);
      if (scrubTimer.current) window.clearTimeout(scrubTimer.current);
    };
  }, [closePlayback, installPlan, item, session, startPosition]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const active = stateRef.current;
      const video = videoRef.current;
      if (active && video) void reportProgress(session, active.plan.session_id, sourcePosition(), video.paused).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [session, sourcePosition]);

  function revealHud() {
    setHud(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (!panel) hideTimer.current = window.setTimeout(() => setHud(false), 4500);
  }

  function seekBy(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(duration || Infinity, sourcePosition() + seconds));
    const active = stateRef.current;
    const offset = active?.plan.timeline.timeline_offset_seconds ?? 0;
    const localTarget = target - offset;
    if (active && (localTarget < 0 || !active.plan.timeline.can_seek_anywhere)) {
      setBusy(true);
      void replanPlaybackV3(session, active, "seek_reanchor", target, qualityRef.current, active.plan.selected_tracks)
        .then(installPlan)
        .catch(reason => setError(reason instanceof Error ? reason.message : "Silo could not seek to that position."))
        .finally(() => setBusy(false));
    } else {
      video.currentTime = Math.max(0, localTarget);
    }
    setPosition(target);
    setScrubbing(true);
    if (scrubTimer.current) window.clearTimeout(scrubTimer.current);
    scrubTimer.current = window.setTimeout(() => setScrubbing(false), 1800);
  }

  function scrubPosition(clientX: number) {
    const track = timelineRef.current;
    if (!track || duration <= 0) return position;
    const bounds = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    return fraction * duration;
  }

  function applyScrub(clientX: number, commit: boolean) {
    const nextPosition = scrubPosition(clientX);
    setPosition(nextPosition);
    setScrubbing(true);
    revealHud();
    if (!commit) return;
    const video = videoRef.current;
    if (video) {
      const offset = stateRef.current?.plan.timeline.timeline_offset_seconds ?? 0;
      const localTarget = nextPosition - offset;
      const active = stateRef.current;
      if (active && (localTarget < 0 || !active.plan.timeline.can_seek_anywhere)) {
        setBusy(true);
        void replanPlaybackV3(session, active, "seek_reanchor", nextPosition, qualityRef.current, active.plan.selected_tracks)
          .then(installPlan)
          .catch(reason => setError(reason instanceof Error ? reason.message : "Silo could not seek to that position."))
          .finally(() => setBusy(false));
      } else {
        video.currentTime = Math.max(0, localTarget);
        if (dragWasPlaying.current) void video.play().catch(() => undefined);
      }
    }
    if (scrubTimer.current) window.clearTimeout(scrubTimer.current);
    scrubTimer.current = window.setTimeout(() => setScrubbing(false), 1800);
  }

  function beginTimelineDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (duration <= 0) return;
    const video = videoRef.current;
    dragWasPlaying.current = Boolean(video && !video.paused);
    video?.pause();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    applyScrub(event.clientX, false);
    event.preventDefault();
  }

  function moveTimelineDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    applyScrub(event.clientX, false);
    event.preventDefault();
  }

  function endTimelineDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    applyScrub(event.clientX, true);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    event.preventDefault();
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

  useEffect(() => {
    const isBackKey = (event: KeyboardEvent) =>
      event.key === "Escape" || event.key === "Backspace" || event.key === "GoBack"
      || event.keyCode === 461 || event.keyCode === 10009;

    const movePanelFocus = (offset: number) => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".player-options .option-row"));
      if (!rows.length) return;
      const index = rows.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? 0 : (index + offset + rows.length) % rows.length;
      rows[next].focus();
    };

    const onKey = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      revealHud();
      if (panel) {
        // The options panel owns the remote: rows are arrow-driven, OK activates
        // the row natively, and Back closes the panel. Global navigation must not
        // move focus out of the panel while it is open.
        if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); movePanelFocus(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); movePanelFocus(-1); }
        else if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); }
        else if (isBackKey(event)) { event.preventDefault(); event.stopPropagation(); setPanel(null); }
        return;
      }
      const onFocusedControl = document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute("data-tv-focusable");
      if (event.key === "MediaStop") { closePlayback(false); onBack(); }
      else if (event.key === "MediaPlay") void video.play();
      else if (event.key === "MediaPause") video.pause();
      else if (event.key === "MediaPlayPause" || ((event.key === "Enter" || event.key === " ") && !onFocusedControl)) video.paused ? void video.play() : video.pause();
      else if (event.key === "MediaFastForward") seekBy(30);
      else if (event.key === "MediaRewind") seekBy(-30);
      else if (event.key === "ArrowLeft") seekBy(-10);
      else if (event.key === "ArrowRight") seekBy(10);
      else if (isBackKey(event)) { closePlayback(false); onBack(); }
      else return;
      event.preventDefault(); event.stopPropagation();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [closePlayback, onBack, panel]);

  const episode = detail?.season_number != null && detail.episode_number != null ? `S${String(detail.season_number).padStart(2, "0")}E${String(detail.episode_number).padStart(2, "0")} · ` : "";
  const audioTracks = version?.audio_tracks ?? [];
  const subtitles = plan?.subtitle.inventory ?? [];
  const qualities = plan?.available_qualities ?? [];
  const chapters = version?.chapters ?? [];
  const currentChapter = [...chapters].reverse().find(chapter => chapter.start_seconds <= position);
  const progress = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
  const formatTime = (seconds: number) => {
    const value = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
  };

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

  return <main className="player-shell" onMouseMove={revealHud}>
    <video ref={videoRef} className="player" playsInline onPlay={() => revealHud()} onPause={() => revealHud()} onEnded={() => { if (onEnded) { closePlayback(false); onEnded(); } }} onTimeUpdate={(event) => { setPosition(sourcePosition()); setDuration(version?.duration ?? event.currentTarget.duration ?? 0); }} onDurationChange={(event) => setDuration(version?.duration ?? event.currentTarget.duration ?? 0)} onError={handleMediaError} />
    <div className={`player-chrome ${hud || panel ? "visible" : ""}`}>
      <button data-tv-focusable="true" className="tv-button secondary top-back player-back" onClick={() => { closePlayback(false); onBack(); }}>‹ Back</button>
      <div className="player-title"><div className="eyebrow">{detail?.series_title ?? item.SeriesName ?? "Now Playing"}</div><h2>{episode}{detail?.title ?? item.Name}</h2>{(detail?.overview ?? item.Overview) ? <p>{detail?.overview ?? item.Overview}</p> : null}</div>
      <div className="player-controls">
        <button data-tv-focusable="true" className="tv-button" onClick={() => setPanel("audio")} disabled={!audioTracks.length}>Audio</button>
        <button data-tv-focusable="true" className="tv-button" onClick={() => setPanel("subtitles")}>Subtitles</button>
        <button data-tv-focusable="true" className="tv-button" onClick={() => setPanel("quality")} disabled={!qualities.length}>Quality · {qualityRef.current}</button>
      </div>
      <div className={`player-timeline ${scrubbing ? "scrubbing" : ""}`}>
        {scrubbing ? <div className="chapter-preview" style={{ left: `${Math.max(8, Math.min(92, progress))}%` }}>{currentChapter?.thumbnail_url ? <img src={currentChapter.thumbnail_url} alt="" /> : null}<strong>{currentChapter?.title || (chapters.length ? `Chapter ${currentChapter?.index != null ? currentChapter.index + 1 : 1}` : detail?.title ?? item.Name)}</strong><span>{formatTime(position)}</span></div> : null}
        <div className="timeline-meta"><span>{formatTime(position)}</span><strong>{currentChapter?.title || (chapters.length ? "Chapter 1" : "")}</strong><span>-{formatTime(Math.max(0, duration - position))}</span></div>
        <div ref={timelineRef} className="timeline-hit-area" role="slider" aria-label="Playback position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(position)} tabIndex={0} data-tv-focusable="true" onPointerDown={beginTimelineDrag} onPointerMove={moveTimelineDrag} onPointerUp={endTimelineDrag} onPointerCancel={endTimelineDrag}>
          <div className="timeline-track"><div className="timeline-fill" style={{ width: `${progress}%` }} />{chapters.map(chapter => duration > 0 && chapter.start_seconds > 0 ? <i key={chapter.index} title={chapter.title} style={{ left: `${Math.min(100, chapter.start_seconds / duration * 100)}%` }} /> : null)}<b style={{ left: `${progress}%` }} /></div>
        </div>
      </div>
      <div className="player-help">◀ 10s · OK Play/Pause · 10s ▶ · Back Exit</div>
      {busy ? <div className="player-status">Asking Silo for the best playback route…</div> : null}
      {error ? <div className="player-error">{error}</div> : null}
    </div>
    {panel ? <section className="player-options"><div className="eyebrow">Playback</div><h2>{panel === "audio" ? "Audio" : panel === "subtitles" ? "Subtitles" : "Quality"}</h2>
      {panel === "audio" && audioTracks.map((track, i) => <button autoFocus={i === 0} className="option-row" key={track.index ?? i} onClick={() => selectAudio(track)}><span>{track.title || track.language || `Track ${i + 1}`}</span><small>{[track.codec?.toUpperCase(), track.channels ? `${track.channels} ch` : ""].filter(Boolean).join(" · ")}</small></button>)}
      {panel === "subtitles" ? <><button autoFocus className="option-row" onClick={() => selectSubtitle()}><span>Off</span></button>{subtitles.map(track => <button className="option-row" key={track.track_id} onClick={() => selectSubtitle(track)}><span>{subtitleName(track)}</span><small>{subtitleDetail(track)}</small></button>)}</> : null}
      {panel === "quality" && qualities.map((quality, i) => <button autoFocus={i === 0} className="option-row" key={quality.label} onClick={() => selectQuality(quality)}><span>{quality.preserves_source ? `Original${quality.height ? ` · ${quality.height}p` : version?.resolution ? ` · ${version.resolution}` : ""}` : quality.label}</span><small>{quality.bitrate_kbps ? `${Math.round(quality.bitrate_kbps / 100) / 10} Mbps` : ""}</small></button>)}
    </section> : null}
  </main>;
}
