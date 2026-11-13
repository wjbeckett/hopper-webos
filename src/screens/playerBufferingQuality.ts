import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaybackPlan } from "../api/playback";
import { BufferingQualityController, RENDERER_WAIT_BUFFER_MS, RENDERER_WAIT_MAX_MS, type BufferingQualityMode, type BufferingQualityNotice, type BufferingQualityPill, type BufferingQualityReplan } from "../core/bufferingQuality";

/** How often a renderer wait is checked to see whether it has become the network's. */
const WAIT_CHECK_MS = 500;
/** What a renderer wait must still hold to stay one after RENDERER_WAIT_MAX_MS. */
const RESUME_BUFFER_MS = 2_000;
const NOTICE_MS = 4_000;
/** How often the playhead is checked for a stall the TV did not report. */
const PROGRESS_CHECK_MS = 250;
/** The playhead standing still this long while playing is a wait, reported or not. */
const STUCK_MS = 750;

/** The controller's view of a plan. `adoptionId` is unique per adoption; the server plan_id can repeat. */
export function bufferingPlanOf(plan: PlaybackPlan, adoptionId: string, quality: string) {
  return {
    planId: adoptionId,
    serverPlanId: plan.plan_id,
    deliveredKbps: plan.effective_recipe?.bitrate_kbps ?? plan.source?.bitrate_kbps ?? null,
    quality,
    availableQualities: (plan.available_qualities ?? []).map(rung => ({ label: rung.label, bitrateKbps: rung.bitrate_kbps ?? 0 })),
    qualityReductionUnavailable: (plan.degradation_warnings ?? []).includes("quality_reduction_unavailable"),
    activeQuality: plan.active_quality ?? null
  };
}

function bufferedAheadMs(video: HTMLVideoElement) {
  const at = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= at + 0.05 && video.buffered.end(i) >= at) return (video.buffered.end(i) - at) * 1000;
  }
  return 0;
}

/**
 * Buffering quality in the player: the controller (core/bufferingQuality), fed from the video
 * element and hls.js the way Android's BufferingQualityPlayerAdapter feeds it from Media3.
 *
 * - `playing` → onPlaying. `pause` and `ended` → onPause. `seeking` → onSeek.
 * - `waiting` → onWaiting: "seek" after a seek, "reload" after a new source, "renderer" when more
 *   than RENDERER_WAIT_BUFFER_MS is buffered past the playhead (the TV is behind, not the network),
 *   otherwise "network". A renderer wait is re-announced as a network wait when the buffer drains
 *   to that threshold, or when it is still waiting RENDERER_WAIT_MAX_MS later with little buffered.
 * - Segment requests, byte by byte as they arrive, give the plan's measured throughput (the
 *   evidence a lowering needs before the first frame) and end a transport outage; fragment load
 *   errors start one.
 *
 * webOS does not always fire `waiting`: on a link slower than the stream, a TV was seen crawling
 * at 0.6× speed with under a second buffered and no event. So the playhead is also watched: one
 * that stands still for STUCK_MS while the video is meant to play is a wait, and one that moves
 * again is playing. Events and the watch share one phase, so each change is reported once.
 *
 * Differences from Android: no outage detection from silent requests (Hopper's own connection
 * check handles a server that stops answering), and no start deadline (Hopper restarts a start
 * that fails, see recoverStream).
 */
export function usePlayerBufferingQuality(options: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Sends the controller's replan. Resolves true when the new plan was installed. */
  sendReplan: (replan: BufferingQualityReplan) => Promise<boolean>;
}) {
  const sendRef = useRef(options.sendReplan);
  sendRef.current = options.sendReplan;
  const [pill, setPill] = useState<BufferingQualityPill>({ kind: "hidden" });
  const [notice, setNotice] = useState<BufferingQualityNotice | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  /** The playing plan's media bytes, and the time media requests were in flight, as they arrive. */
  const throughput = useRef({ bytes: 0, ms: 0, inFlight: 0, since: 0 });
  const flags = useRef({ seeking: false, reload: false });

  const controller = useMemo(() => new BufferingQualityController({
    clock: () => performance.now(),
    onReplan: replan => {
      void sendRef.current(replan).then(installed => { if (!installed) controller.onReplanFailed(); }, () => controller.onReplanFailed());
    },
    onNotice: next => {
      setNotice(next);
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
    },
    onPill: setPill,
    onPlanSummary: summary => console.info("[Hopper] buffering_quality plan_summary", summary),
    planThroughputKbps: () => {
      const { bytes, ms, inFlight, since } = throughput.current;
      const elapsed = ms + (inFlight > 0 ? performance.now() - since : 0);
      return bytes > 0 && elapsed > 0 ? Math.round((bytes * 8) / elapsed) : null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => () => { controller.onPlaybackStopped(); window.clearTimeout(noticeTimer.current); }, [controller]);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video) return;
    let phase: "playing" | "waiting" | "paused" = "paused";
    let rendererCheck: number | undefined;
    let rendererSince = 0;
    let lastTime = -1;
    let stillSince = 0;
    const stopRendererCheck = () => { window.clearInterval(rendererCheck); rendererCheck = undefined; };
    const playing = () => {
      stopRendererCheck();
      flags.current = { seeking: false, reload: false };
      if (phase === "playing") return;
      phase = "playing";
      controller.onPlaying();
    };
    const waiting = () => {
      if (video.paused || phase === "waiting") return;
      phase = "waiting";
      stopRendererCheck();
      const cause = flags.current.seeking ? "seek" : flags.current.reload ? "reload" : bufferedAheadMs(video) > RENDERER_WAIT_BUFFER_MS ? "renderer" : "network";
      controller.onWaiting(cause);
      if (cause !== "renderer") return;
      rendererSince = performance.now();
      rendererCheck = window.setInterval(() => {
        const ahead = bufferedAheadMs(video);
        const drained = ahead <= RENDERER_WAIT_BUFFER_MS;
        const tooLong = performance.now() - rendererSince >= RENDERER_WAIT_MAX_MS && ahead < RESUME_BUFFER_MS;
        if (!drained && !tooLong) return;
        stopRendererCheck();
        controller.onWaiting("network");
      }, WAIT_CHECK_MS);
    };
    const paused = () => {
      stopRendererCheck();
      if (video.seeking || phase === "paused") return;
      phase = "paused";
      controller.onPause();
    };
    const onPlayingEvent = () => { lastTime = video.currentTime; stillSince = performance.now(); playing(); };
    const onSeeking = () => {
      flags.current.seeking = true;
      controller.onSeek();
      if (phase === "waiting") { phase = "playing"; waiting(); }
    };
    // The playhead watch: a stall the TV did not report, and the end of one.
    const watch = window.setInterval(() => {
      const now = performance.now();
      const time = video.currentTime;
      const meantToPlay = !video.paused && !video.ended && !video.seeking;
      if (time !== lastTime) {
        lastTime = time;
        stillSince = now;
        if (meantToPlay && phase === "waiting") playing();
        return;
      }
      if (meantToPlay && phase !== "waiting" && now - stillSince >= STUCK_MS) waiting();
    }, PROGRESS_CHECK_MS);
    const onVisibility = () => controller.setViewHidden(document.visibilityState === "hidden");
    video.addEventListener("playing", onPlayingEvent);
    video.addEventListener("waiting", waiting);
    video.addEventListener("pause", paused);
    video.addEventListener("ended", paused);
    video.addEventListener("seeking", onSeeking);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopRendererCheck();
      window.clearInterval(watch);
      video.removeEventListener("playing", onPlayingEvent);
      video.removeEventListener("waiting", waiting);
      video.removeEventListener("pause", paused);
      video.removeEventListener("ended", paused);
      video.removeEventListener("seeking", onSeeking);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [controller, options.videoRef]);

  /** A plan became the playing one. `controllerInitiated`: it answers the controller's own replan. */
  const adopt = useCallback((plan: PlaybackPlan, adoptionId: string, quality: string, controllerInitiated: boolean, replacesPlaying: boolean) => {
    throughput.current = { bytes: 0, ms: 0, inFlight: 0, since: 0 };
    flags.current.reload = replacesPlaying;
    controller.onPlanAdopted(bufferingPlanOf(plan, adoptionId, quality), controllerInitiated);
  }, [controller]);

  /**
   * Follows one media (segment) request: bytes count as they arrive, so a start whose first
   * segment takes longer than the stall timer still has a measured throughput. A request that
   * receives bytes also ends an outage.
   */
  const trackMediaRequest = useCallback((xhr: XMLHttpRequest) => {
    const meter = throughput.current;
    let counted = 0;
    let open = false;
    const start = () => {
      if (open) return;
      open = true;
      if (meter.inFlight++ === 0) meter.since = performance.now();
    };
    const end = () => {
      if (!open) return;
      open = false;
      if (--meter.inFlight === 0) meter.ms += performance.now() - meter.since;
    };
    xhr.addEventListener("loadstart", start);
    xhr.addEventListener("progress", event => {
      // A request from a plan that has since been replaced no longer counts.
      if (throughput.current !== meter) return;
      start();
      meter.bytes += event.loaded - counted;
      counted = event.loaded;
      if (controller.inTransportTrouble && event.loaded > 0) controller.onTransportErrorEnd();
    });
    xhr.addEventListener("loadend", end);
  }, [controller]);

  /** hls.js failed to load media and will retry. */
  const noteTransportError = useCallback(() => {
    if (!controller.inTransportTrouble) controller.onTransportErrorStart();
  }, [controller]);

  const setMode = useCallback((mode: BufferingQualityMode) => controller.setMode(mode), [controller]);

  return { controller, pill, notice, adopt, trackMediaRequest, noteTransportError, setMode };
}

export const BUFFERING_COPY = {
  promptTitle: "Playback keeps buffering",
  lower: "Lower quality",
  keep: "Keep quality",
  lowered: "Quality lowered to stop buffering",
  restore: "Restore quality",
  cantLower: "Can't lower quality for this video"
} as const;
