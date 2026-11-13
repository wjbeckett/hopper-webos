/**
 * What the player does when playback keeps buffering: the buffering-quality state machine.
 *
 * A port of Android's `BufferingQualityController` (silo-android shared/.../domain/player), which
 * implements the Silo server repo's `docs/design/2026-10-17-buffering-quality.md`. The server's
 * conformance vectors (`src/core/fixtures/buffering-quality-v1-vectors.json`, vendored unchanged)
 * are replayed against it in `bufferingQuality.test.ts`; web, Apple and Android replay the same
 * file. A failing case is a divergence: fix this file, never the vectors.
 *
 * It never touches the player. The player feeds it playback events and the viewer's answers; it
 * hands back replans through `onReplan`, notices through `onNotice`, and publishes the pill
 * through `onPill`.
 *
 * Stall detection (the web player's `createStallTracker`): stall time inside the startup grace
 * does not count, a stall must last STALL_MIN_MS to count, and the trigger is STALLS_BEFORE_TRIGGER
 * counted stalls inside STALL_WINDOW_MS or one stall reaching LONG_STALL_MS. It is evaluated on
 * `onPlaying` and when a stall in progress reaches LONG_STALL_MS, never on `onWaiting`.
 *
 * On Auto in `always` mode a trigger lowers at once (a `quality_change` with a step-down
 * `bandwidth_estimate_kbps`) and offers "Restore quality"; in `ask` mode, or on a quality the
 * viewer picked, it offers "Lower quality" / "Keep quality" first; `never` only reports.
 */

export const STARTUP_GRACE_MS = 10_000;
export const STALL_MIN_MS = 1_000;
export const STALLS_BEFORE_TRIGGER = 2;
export const STALL_WINDOW_MS = 120_000;
export const LONG_STALL_MS = 6_000;
export const PROMPT_SECONDS = 15;
export const REOFFER_MIN_MS = 120_000;
export const NO_LOWER_COOLDOWN_MS = 300_000;
export const REARM_AFTER_UNADOPTED_MS = 60_000;
export const RENDERER_WAIT_BUFFER_MS = 1_000;
/** A renderer wait still in progress this long after it began, with little buffered, is a stall. */
export const RENDERER_WAIT_MAX_MS = 3_000;
/**
 * Documentation only: the step-down estimate is the exact integer `delivered × 7 / 10`, because a
 * floating-point 0.7 can floor one kbps low (22120 must give 15484).
 */
export const STEP_DOWN_RATIO = 0.7;
export const MIN_ESTIMATE_KBPS = 100;

export const PLAYBACK_QUALITY_AUTO = "auto";
export const BANDWIDTH_ESTIMATE_SOURCE_OBSERVED_REBUFFER = "observed_rebuffer";
export const LEARNED_LIMIT_CLEAR = "clear";
export const LEARNED_LIMIT_IGNORE = "ignore";
export const BUFFERING_QUALITY_V1_FEATURE = "buffering_quality_v1";

export type BufferingQualityMode = "never" | "ask" | "always";
export const DEFAULT_BUFFERING_QUALITY_MODE: BufferingQualityMode = "always";

export function bufferingQualityModeFrom(value: unknown): BufferingQualityMode | null {
  return value === "never" || value === "ask" || value === "always" ? value : null;
}

export type BufferingQualityRung = { label: string; bitrateKbps: number };

export type BufferingQualityPlan = {
  /** The local adoption identity, unique per adoption (a replan can return the same server plan_id). */
  planId: string;
  /** `effective_recipe.bitrate_kbps`, else `source.bitrate_kbps`; null or non-positive when neither. */
  deliveredKbps: number | null;
  /** The plan's quality preference: `auto`, or the rung label the viewer picked. */
  quality: string;
  /** `available_qualities`, in the server's order. */
  availableQualities: BufferingQualityRung[];
  /** `degradation_warnings` carries `quality_reduction_unavailable`. */
  qualityReductionUnavailable?: boolean;
  /** The server plan_id, which can repeat across adoptions. */
  serverPlanId?: string;
  /** The `available_qualities` label the plan names in `active_quality`, if any. */
  activeQuality?: string | null;
};

/** Why the player started waiting. Only "network", running out of data, can become a stall. */
export type BufferingWaitCause = "network" | "seek" | "pause" | "reload" | "renderer";

/** The `quality_change` replan the controller wants sent. */
export type BufferingQualityReplan = {
  qualityPreference: string;
  bandwidthEstimateKbps?: number;
  bandwidthEstimateSource?: string;
  learnedLimit?: string;
};

export type BufferingQualityNotice = "lowered" | "cant_lower";

export type BufferingQualityPill =
  | { kind: "hidden" }
  | { kind: "prompt"; secondsRemaining: number }
  | { kind: "undo"; secondsRemaining: number };

export type BufferingAction = "none" | "ignored" | "lowered" | "restored" | "accepted" | "kept" | "timed_out" | "cant_lower";

export type BufferingPlanSummary = {
  planId: string;
  playedMs: number;
  stallCount: number;
  stallTotalMs: number;
  stallLongestMs: number;
  deliveredKbps: number | null;
  mode: BufferingQualityMode;
  action: BufferingAction;
  adoptionId: string;
};

/** Timers, injectable so the vectors can run on a fake clock. Returns a cancel function. */
export type Schedule = (delayMs: number, action: () => void) => () => void;

export const realSchedule: Schedule = (delayMs, action) => {
  const timer = window.setTimeout(action, Math.max(0, delayMs));
  return () => window.clearTimeout(timer);
};

/**
 * A coroutine job, as far as the controller needs one: active until it finishes or is cancelled.
 * `after` runs at once when the delay is not positive, as Kotlin's `delay` does.
 */
class Job {
  active = true;
  private cancelTimer: (() => void) | null = null;
  constructor(private readonly schedule: Schedule) {}
  after(delayMs: number, action: () => void) {
    if (!this.active) return;
    if (delayMs <= 0) { action(); return; }
    this.cancelTimer = this.schedule(delayMs, () => {
      this.cancelTimer = null;
      if (this.active) action();
    });
  }
  finish() { this.active = false; }
  cancel() {
    this.active = false;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}

type PillKind = "prompt" | "undo";
type PendingKind = "automatic" | "accepted" | "restore";

type Pending = { kind: PendingKind; fromKbps: number | null; from?: PlanState; actionBefore: BufferingAction };

/** One plan's stall history. */
class StallTracker {
  firstPlayingAt: number | null = null;
  /** The first wait before any frame; a start that never gets going is timed from here. */
  firstWaitingAt: number | null = null;
  /** When the stall being timed started counting, or null when none is. */
  stallStartedAt: number | null = null;
  /** A network wait is in progress, timed or not (an outage pauses the timing). */
  stalled = false;
  /** When each counted short stall ended. */
  stallEnds: number[] = [];
  /** When a stall that reached LONG_STALL_MS ended. */
  longStallEndedAt: number | null = null;

  /** The plan has not played yet: its reload and seek waits are the start's. */
  get starting() { return this.firstPlayingAt == null; }

  noteWaiting(now: number) {
    if (this.firstPlayingAt == null && this.firstWaitingAt == null) this.firstWaitingAt = now;
  }

  /** The grace runs from a wait before playback first runs, or else from that first run. */
  graceEndsAt(now: number) {
    return (this.firstWaitingAt ?? this.firstPlayingAt ?? now) + STARTUP_GRACE_MS;
  }

  shouldTrigger(now: number) {
    if (this.longStallEndedAt != null && now - this.longStallEndedAt < STALL_WINDOW_MS) return true;
    if (this.stallStartedAt != null && now - this.stallStartedAt >= LONG_STALL_MS) return true;
    this.stallEnds = this.stallEnds.filter(end => now - end < STALL_WINDOW_MS);
    return this.stallEnds.length >= STALLS_BEFORE_TRIGGER;
  }
}

/** Everything the controller tracks about the playing plan. */
class PlanState {
  readonly tracker = new StallTracker();
  /** The plan has played, which a stall-history reset does not stand in for. */
  played = false;
  action: BufferingAction = "none";
  /** No trigger acts on this plan before this time ("can't lower" result). */
  cooldownUntil: number | null = null;
  /** The caller's failure path for a missed start deadline whose lowering is out. */
  deadlineFailurePath: (() => void) | null = null;
  playingSince: number | null = null;
  playedMs = 0;
  /** When the stall in progress started, for the summary; a history reset does not move it. */
  statsStallStartedAt: number | null = null;
  stallCount = 0;
  stallTotalMs = 0;
  stallLongestMs = 0;
  constructor(readonly plan: BufferingQualityPlan, readonly replacement: boolean) {}
  /** A plan of the attempt, this one or one it replaced, has played. */
  get attemptStarted() { return this.replacement || this.played; }
}

const positive = (value: number | null | undefined) => (value != null && value > 0 ? value : null);

export type BufferingQualityControllerOptions = {
  /** Monotonic milliseconds. */
  clock: () => number;
  schedule?: Schedule;
  onReplan: (replan: BufferingQualityReplan) => void;
  onNotice: (notice: BufferingQualityNotice) => void;
  onPlanSummary?: (summary: BufferingPlanSummary) => void;
  onPill?: (pill: BufferingQualityPill) => void;
  /** The playing plan's measured throughput so far, or null when it has none. */
  planThroughputKbps: () => number | null;
};

export class BufferingQualityController {
  private readonly clock: () => number;
  private readonly schedule: Schedule;
  private readonly onReplan: (replan: BufferingQualityReplan) => void;
  private readonly onNotice: (notice: BufferingQualityNotice) => void;
  private readonly onPlanSummary: (summary: BufferingPlanSummary) => void;
  private readonly onPill: (pill: BufferingQualityPill) => void;
  private readonly planThroughputKbps: () => number | null;

  private pillValue: BufferingQualityPill = { kind: "hidden" };
  private timerRunningValue = false;

  // Settings and player state
  private mode: BufferingQualityMode = DEFAULT_BUFFERING_QUALITY_MODE;
  private enabled = true;
  private suspended = false;
  private otherPillVisible = false;
  private viewHidden = false;
  private paused = false;
  private transportTrouble = false;
  private transportTroubleEndedAt: number | null = null;
  private waitCause: BufferingWaitCause | null = null;
  private pickPending = false;

  // The playing plan
  private current: PlanState | null = null;

  // Per-title state
  private answeredQuality: string | null = null;
  private cantLowerShown = false;
  private reofferNotBefore: number | null = null;
  private pending: Pending | null = null;

  // Pill
  private activePill: PillKind | null = null;
  private deferredPill: PillKind | null = null;
  private deferredResumes = false;
  private promptShownAt = 0;
  private pillRemainingMs = 0;
  private pillStepStartedAt = 0;
  private pillJob: Job | null = null;

  // Timers
  private longStallJob: Job | null = null;
  private reevaluateJob: Job | null = null;
  private rearmJob: Job | null = null;

  constructor(options: BufferingQualityControllerOptions) {
    this.clock = options.clock;
    this.schedule = options.schedule ?? realSchedule;
    this.onReplan = options.onReplan;
    this.onNotice = options.onNotice;
    this.onPlanSummary = options.onPlanSummary ?? (() => undefined);
    this.onPill = options.onPill ?? (() => undefined);
    this.planThroughputKbps = options.planThroughputKbps;
  }

  /** The pill on screen now. */
  get pill(): BufferingQualityPill { return this.pillValue; }
  /** False while a pill is up but its timer is frozen by a pause. */
  get timerRunning() { return this.timerRunningValue; }
  /** A plan is playing, or loading, under this controller. */
  get hasPlan() { return this.current != null; }
  /** The playing plan replaced another after the attempt had played, and has not played yet. */
  get loadingReplacement() { return Boolean(this.current?.replacement && this.current.tracker.starting); }

  private launch(body: (job: Job) => void): Job {
    const job = new Job(this.schedule);
    body(job);
    return job;
  }

  /** The effective `playback.buffering_quality_mode`. */
  setMode(mode: BufferingQualityMode) {
    this.mode = mode;
    if (mode === "never") this.hidePill();
  }

  get currentMode() { return this.mode; }

  /** False when playback has no server plan: the pill hides and events are ignored. */
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    if (!enabled) this.dropPlan(this.clock());
    this.enabled = enabled;
  }

  /** A higher-priority pill (intro or other segment skip, Up Next) is on screen. */
  setOtherPillVisible(visible: boolean) {
    this.otherPillVisible = visible;
    if (!this.enabled) return;
    if (visible) { this.obscurePill(); return; }
    const kind = this.deferredPill;
    if (!kind) return;
    if (this.viewHidden && kind === "prompt") return;
    this.present(kind, this.deferredResumes);
  }

  /** The player cannot show pills (the app is in the background), or can again. */
  setViewHidden(hidden: boolean) {
    if (hidden === this.viewHidden) return;
    this.viewHidden = hidden;
    if (!this.enabled) return;
    if (hidden && this.activePill === "prompt") { this.obscurePill(); return; }
    this.publishPill();
    if (!hidden && !this.otherPillVisible && this.deferredPill) this.present(this.deferredPill, this.deferredResumes);
  }

  /** The playing plan's summary so far, without ending the plan. */
  runningSummary(): BufferingPlanSummary | null {
    return this.current ? this.summaryOf(this.current, this.clock()) : null;
  }

  /**
   * A new adoption became the playing plan. `controllerInitiated` false means it answers a replan
   * the controller did not send (a track change, a recovery).
   */
  onPlanAdopted(plan: BufferingQualityPlan, controllerInitiated = true, pickStillPending = false) {
    if (!this.enabled) return;
    if (this.current?.plan.planId === plan.planId) return;
    const now = this.clock();
    this.transportTrouble = false;
    const settled = this.pending;
    const previous = this.current;
    this.dropPlan(now);
    const reload = previous != null && previous.attemptStarted;
    const state = new PlanState(plan, reload);
    if (previous && !reload) state.tracker.firstWaitingAt = previous.tracker.firstWaitingAt;
    this.current = state;
    if (pickStillPending) this.pickPending = true;
    else if (!controllerInitiated) this.pickPending = false;

    if (!settled) return;
    if (!controllerInitiated || settled.kind === "restore") return;
    const delivered = positive(plan.deliveredKbps);
    const noLower = Boolean(plan.qualityReductionUnavailable) ||
      (delivered != null && settled.fromKbps != null && delivered >= settled.fromKbps);
    const quiet = this.pickPending;
    if (noLower) {
      state.action = "cant_lower";
      state.cooldownUntil = now + NO_LOWER_COOLDOWN_MS;
      if (!quiet) {
        this.cantLowerShown = true;
        this.onNotice("cant_lower");
      }
    } else if (quiet) {
      // The viewer's pick on its way replaces this plan: it shows nothing.
    } else if (settled.kind === "automatic") {
      this.showPill("undo");
    } else {
      this.onNotice("lowered");
    }
  }

  /** Playback is running: the first frame, or a resume from waiting or pause. */
  onPlaying() {
    this.paused = false;
    this.waitCause = null;
    if (!this.enabled) return;
    const state = this.current;
    if (!state) return;
    const now = this.clock();
    this.thawPill();
    const startWait = !state.attemptStarted;
    state.played = true;
    if (state.playingSince == null) state.playingSince = now;
    const tracker = state.tracker;
    if (tracker.firstPlayingAt == null) tracker.firstPlayingAt = now;
    tracker.stalled = false;

    if (state.statsStallStartedAt != null) this.recordStallStat(state, now - state.statsStallStartedAt);
    state.statsStallStartedAt = null;

    const startedAt = tracker.stallStartedAt;
    if (startedAt != null) {
      this.clearStallTiming(state);
      const duration = now - startedAt;
      if (startWait && !this.slowLinkEvidence(state.plan)) {
        // Not shown to be the network's.
      } else if (duration >= LONG_STALL_MS) {
        tracker.longStallEndedAt = now;
      } else if (duration >= STALL_MIN_MS) {
        tracker.stallEnds.push(now);
      }
    }
    this.evaluate(now);
  }

  /** The player is waiting for `cause`; only a network wait can be a stall. */
  onWaiting(cause: BufferingWaitCause = "network") {
    if (cause !== "pause") this.paused = false;
    this.waitCause = cause;
    if (!this.enabled) return;
    const state = this.current;
    if (!state) return;
    const now = this.clock();
    if (!this.paused) this.thawPill();
    this.stopPlayedClock(state, now);
    const tracker = state.tracker;
    if (state.replacement && tracker.starting) {
      // A replacement's load is a source reload, however long it takes.
      this.interrupt(state, now);
      return;
    }
    const startWait = tracker.starting && (cause === "reload" || cause === "seek");
    if (cause !== "network" && !startWait) {
      this.interrupt(state, now);
      return;
    }
    tracker.stalled = true;
    tracker.noteWaiting(now);
    if (this.transportTrouble) return;
    this.startStallTiming(state, now);
  }

  /** The viewer paused. */
  onPause() {
    this.paused = true;
    this.waitCause = null;
    if (!this.enabled) return;
    this.freezePill();
    const state = this.current;
    if (!state) return;
    const now = this.clock();
    this.stopPlayedClock(state, now);
    this.interrupt(state, now);
  }

  /** The viewer seeked. A seek before the plan first plays leaves the start's wait running. */
  onSeek() {
    if (!this.enabled) return;
    const state = this.current;
    if (!state || state.tracker.starting) return;
    const now = this.clock();
    this.stopPlayedClock(state, now);
    this.interrupt(state, now);
  }

  /** Media requests started failing; the outage owns any wait until it ends. */
  onTransportErrorStart() {
    this.transportTrouble = true;
    if (!this.enabled) return;
    const state = this.current;
    if (!state) return;
    if (state.tracker.stallStartedAt != null) {
      this.clearStallTiming(state);
      state.statsStallStartedAt = null;
    }
  }

  /** Media requests recovered. */
  onTransportErrorEnd() {
    this.transportTrouble = false;
    this.transportTroubleEndedAt = this.clock();
    if (!this.enabled) return;
    const state = this.current;
    if (!state) return;
    if (state.tracker.stalled && state.tracker.stallStartedAt == null) this.startStallTiming(state, this.clock());
  }

  get inTransportTrouble() { return this.transportTrouble; }

  /** The controller's last replan failed or will never be adopted. */
  onReplanFailed() {
    if (!this.enabled) return;
    const failed = this.pending;
    if (failed?.kind === "automatic" && failed.from) failed.from.action = failed.actionBefore;
    this.pending = null;
    this.runDeadlineFailurePath();
  }

  /** The viewer picked a quality from the menu, and the pick is on its way. */
  onQualityPickSent() {
    if (!this.enabled) return;
    this.pickPending = true;
    this.hidePill();
  }

  /** The server refused the pick. */
  onQualityPickRefused() {
    if (!this.pickPending) return;
    this.pickPending = false;
    this.evaluate(this.clock());
  }

  /** A quality change the controller did not send took effect. Call it before adopting that plan. */
  onViewerQualityChange() {
    this.pickPending = false;
    if (!this.enabled) return;
    this.hidePill();
    this.answeredQuality = null;
    this.reofferNotBefore = null;
    this.pending = null;
    this.rearmJob?.cancel();
    this.rearmJob = null;
    if (this.current) this.resetTracker(this.current, this.clock());
  }

  /** The playing plan stopped (ended, closed or failed) without a successor. */
  onPlaybackStopped() {
    if (!this.enabled) return;
    this.dropPlan(this.clock());
  }

  /** A new playback attempt of the same title that the viewer did not choose (a restart, Retry). */
  onNewAttempt() { this.onPlaybackStopped(); }

  /**
   * The playing plan missed the player's own start deadline before it first played. On Auto in
   * `always` mode, with evidence the media arrived more slowly than its bitrate, it lowers as a
   * long stall would and returns true; otherwise false, leaving the caller's failure path to run.
   */
  onStartDeadlineMissed(failurePath: () => void): boolean {
    if (!this.enabled || this.suspended || this.pickPending || this.pending != null || this.rearmJob?.active) return false;
    const now = this.clock();
    const recentOutage = this.transportTroubleEndedAt != null && now - this.transportTroubleEndedAt < LONG_STALL_MS;
    if (this.transportTrouble || recentOutage || this.waitCause === "renderer") return false;
    const state = this.current;
    if (!state || !state.tracker.starting) return false;
    if (state.cooldownUntil != null && now < state.cooldownUntil) return false;
    const plan = state.plan;
    if (plan.quality !== PLAYBACK_QUALITY_AUTO || this.mode !== "always") return false;
    if (this.answeredQuality === plan.quality || !this.slowLinkEvidence(plan)) return false;
    const lowering = this.loweringFor(plan);
    if (!lowering) return false;
    this.hidePill();
    state.deadlineFailurePath = failurePath;
    this.sendLowering(state, lowering, "automatic");
    return true;
  }

  /** "Lower quality" on the prompt. */
  selectLower(): boolean {
    if (this.activePill !== "prompt") return false;
    const state = this.current;
    if (!state) return false;
    const replan = this.loweringFor(state.plan);
    if (!replan) return false;
    this.hidePill();
    this.sendLowering(state, replan, "accepted");
    return true;
  }

  /** "Keep quality" on the prompt. */
  selectKeep(): boolean {
    if (this.activePill !== "prompt") return false;
    const state = this.current;
    if (!state) return false;
    this.hidePill();
    this.answeredQuality = state.plan.quality;
    state.action = "kept";
    return true;
  }

  /** "Restore quality" on the undo pill. */
  selectRestore(): boolean {
    if (this.activePill !== "undo") return false;
    const state = this.current;
    if (!state) return false;
    this.hidePill();
    state.action = "restored";
    this.answeredQuality = PLAYBACK_QUALITY_AUTO;
    this.pending = { kind: "restore", fromKbps: null, actionBefore: "none" };
    this.startRearm();
    this.onReplan({ qualityPreference: PLAYBACK_QUALITY_AUTO, learnedLimit: LEARNED_LIMIT_CLEAR });
    return true;
  }

  /** OK at the player root: the visible pill's primary action. */
  selectPrimary(): boolean {
    if (this.activePill === "prompt") return this.selectLower();
    if (this.activePill === "undo") return this.selectRestore();
    return false;
  }

  /** Back while a pill shows. True when a pill consumed it. */
  back(): boolean {
    if (this.activePill === "prompt") return this.selectKeep();
    if (this.activePill === "undo") {
      this.hidePill();
      this.undoEnded();
      return true;
    }
    return false;
  }

  /** Clears all per-title state, for when playback moves to different content. */
  reset() {
    this.pickPending = false;
    this.dropPlan(this.clock());
    this.answeredQuality = null;
    this.cantLowerShown = false;
    this.reofferNotBefore = null;
    this.promptShownAt = 0;
  }

  // ---- Trigger

  private evaluate(now: number) {
    if (!this.enabled || this.suspended || this.transportTrouble || this.pickPending) return;
    const state = this.current;
    if (!state) return;
    if (!state.tracker.shouldTrigger(now)) return;
    if (this.isBusy()) return;
    if (state.cooldownUntil != null && now < state.cooldownUntil) {
      this.suppressUntil(state, state.cooldownUntil, now);
      return;
    }
    const plan = state.plan;
    if (this.answeredQuality === plan.quality) return;
    if (!state.attemptStarted && !this.slowLinkEvidence(plan)) return;
    if (this.mode === "never") {
      state.action = "ignored";
      this.resetTracker(state, now);
      return;
    }
    const lowering = this.loweringFor(plan);
    if (!lowering) {
      this.showCantLower(state);
      this.resetTracker(state, now);
      return;
    }
    if (plan.quality === PLAYBACK_QUALITY_AUTO && this.mode === "always") {
      this.sendLowering(state, lowering, "automatic");
      return;
    }
    if (this.reofferNotBefore != null && now < this.reofferNotBefore) {
      this.suppressUntil(state, this.reofferNotBefore, now);
      return;
    }
    this.showPill("prompt");
  }

  private isBusy() {
    return this.pending != null || Boolean(this.rearmJob?.active) || this.activePill != null || this.deferredPill != null;
  }

  /** The plan's media measurably arrived more slowly than its delivered bitrate. */
  private slowLinkEvidence(plan: BufferingQualityPlan) {
    const delivered = positive(plan.deliveredKbps);
    if (delivered == null) return false;
    const observed = this.planThroughputKbps();
    if (observed == null) return false;
    return observed < delivered;
  }

  private suppressUntil(state: PlanState, liftAt: number, now: number) {
    if (state.tracker.stallStartedAt == null) return;
    this.reevaluateJob?.cancel();
    this.reevaluateJob = this.launch(job => job.after(liftAt - now, () => {
      job.finish();
      this.reevaluateJob = null;
      if (this.current === state && state.tracker.stallStartedAt != null) this.evaluate(this.clock());
    }));
  }

  /** The replan that lowers the plan one step, or null when nothing is lower. */
  private loweringFor(plan: BufferingQualityPlan): BufferingQualityReplan | null {
    const rungs = plan.availableQualities
      .filter(rung => rung.bitrateKbps > 0)
      .slice()
      .sort((a, b) => b.bitrateKbps - a.bitrateKbps);
    const delivered = positive(plan.deliveredKbps);
    if (plan.quality === PLAYBACK_QUALITY_AUTO) {
      if (delivered == null) return null;
      if (!rungs.some(rung => rung.bitrateKbps < delivered)) return null;
      // The exact integer floor of delivered × 7 / 10; see STEP_DOWN_RATIO.
      const estimate = Math.floor((delivered * 7) / 10);
      if (estimate < MIN_ESTIMATE_KBPS) return null;
      return {
        qualityPreference: PLAYBACK_QUALITY_AUTO,
        bandwidthEstimateKbps: estimate,
        bandwidthEstimateSource: BANDWIDTH_ESTIMATE_SOURCE_OBSERVED_REBUFFER
      };
    }
    const named = plan.activeQuality != null ? rungs.find(rung => rung.label === plan.activeQuality)?.bitrateKbps ?? null : null;
    const candidates = [named, delivered].filter((value): value is number => value != null);
    if (!candidates.length) return null;
    const ceiling = Math.min(...candidates);
    const lower = rungs.find(rung => rung.bitrateKbps < ceiling);
    return lower ? { qualityPreference: lower.label } : null;
  }

  private sendLowering(state: PlanState, replan: BufferingQualityReplan, kind: PendingKind) {
    this.pending = { kind, fromKbps: positive(state.plan.deliveredKbps), from: state, actionBefore: state.action };
    state.action = kind === "automatic" ? "lowered" : "accepted";
    this.startRearm();
    this.onReplan(replan);
  }

  private showCantLower(state: PlanState) {
    state.action = "cant_lower";
    if (this.cantLowerShown) return;
    this.cantLowerShown = true;
    this.onNotice("cant_lower");
  }

  /** Rearm is timed from the send, whether or not the replan later fails. */
  private startRearm() {
    this.rearmJob?.cancel();
    this.rearmJob = this.launch(job => job.after(REARM_AFTER_UNADOPTED_MS, () => {
      job.finish();
      this.rearmJob = null;
      this.pending = null;
      this.runDeadlineFailurePath();
      if (this.current) this.resetTracker(this.current, this.clock());
    }));
  }

  private runDeadlineFailurePath() {
    const state = this.current;
    if (!state) return;
    const failurePath = state.deadlineFailurePath;
    if (!failurePath) return;
    state.deadlineFailurePath = null;
    if (state.tracker.starting) failurePath();
  }

  // ---- Stall tracker

  /** Starts timing the stall in progress, from the end of the grace at the earliest. */
  private startStallTiming(state: PlanState, now: number) {
    const tracker = state.tracker;
    const startedAt = tracker.stallStartedAt ?? Math.max(now, tracker.graceEndsAt(now));
    tracker.stallStartedAt = startedAt;
    if (state.statsStallStartedAt == null) state.statsStallStartedAt = startedAt;
    if (this.longStallJob?.active) return;
    this.longStallJob = this.launch(job => job.after(startedAt + LONG_STALL_MS - now, () => {
      job.finish();
      this.longStallJob = null;
      if (this.current === state && state.tracker.stallStartedAt === startedAt) this.evaluate(this.clock());
    }));
  }

  /** Stops timing the current stall without ending it. */
  private clearStallTiming(state: PlanState) {
    state.tracker.stallStartedAt = null;
    this.longStallJob?.cancel();
    this.longStallJob = null;
    this.reevaluateJob?.cancel();
    this.reevaluateJob = null;
  }

  /** A seek, pause or reload: a stall in progress ends uncounted, its time kept for the summary. */
  private interrupt(state: PlanState, now: number) {
    state.tracker.stalled = false;
    this.clearStallTiming(state);
    if (state.statsStallStartedAt != null) this.recordStallStat(state, now - state.statsStallStartedAt, false);
    state.statsStallStartedAt = null;
  }

  /** Clears the stall history with the grace treated as elapsed, and times a stall in progress from now. */
  private resetTracker(state: PlanState, now: number) {
    const tracker = state.tracker;
    tracker.firstPlayingAt = now - STARTUP_GRACE_MS;
    tracker.firstWaitingAt = null;
    tracker.stallEnds = [];
    tracker.longStallEndedAt = null;
    this.clearStallTiming(state);
    if (tracker.stalled && !this.transportTrouble) this.startStallTiming(state, now);
  }

  // ---- Summary

  private stopPlayedClock(state: PlanState, now: number) {
    if (state.playingSince != null) state.playedMs += Math.max(0, now - state.playingSince);
    state.playingSince = null;
  }

  private recordStallStat(state: PlanState, durationMs: number, count = true) {
    if (durationMs <= 0) return;
    if (count && durationMs >= STALL_MIN_MS) state.stallCount += 1;
    state.stallTotalMs += durationMs;
    state.stallLongestMs = Math.max(state.stallLongestMs, durationMs);
  }

  private summaryOf(state: PlanState, now: number): BufferingPlanSummary {
    const playingMs = state.playingSince != null ? Math.max(0, now - state.playingSince) : 0;
    const raw = state.statsStallStartedAt != null ? now - state.statsStallStartedAt : 0;
    const stallMs = raw > 0 ? raw : 0;
    return {
      planId: state.plan.serverPlanId ?? state.plan.planId,
      playedMs: state.playedMs + playingMs,
      stallCount: state.stallCount + (stallMs >= STALL_MIN_MS ? 1 : 0),
      stallTotalMs: state.stallTotalMs + stallMs,
      stallLongestMs: Math.max(state.stallLongestMs, stallMs),
      deliveredKbps: state.plan.deliveredKbps,
      mode: this.mode,
      action: state.action,
      adoptionId: state.plan.planId
    };
  }

  /** Emits the playing plan's final summary and forgets the plan, anything in flight and its timers. */
  private dropPlan(now: number) {
    if (this.current) this.onPlanSummary(this.summaryOf(this.current, now));
    this.current = null;
    this.pending = null;
    this.hidePill();
    this.longStallJob?.cancel();
    this.longStallJob = null;
    this.reevaluateJob?.cancel();
    this.reevaluateJob = null;
    this.rearmJob?.cancel();
    this.rearmJob = null;
  }

  // ---- Pill

  private showPill(kind: PillKind) {
    if (this.otherPillVisible || (this.viewHidden && kind === "prompt")) {
      this.deferredPill = kind;
      this.deferredResumes = false;
      return;
    }
    this.present(kind, false);
  }

  private present(kind: PillKind, resume: boolean) {
    this.clearDeferred();
    this.activePill = kind;
    if (!resume) {
      this.pillRemainingMs = PROMPT_SECONDS * 1000;
      if (kind === "prompt") this.promptShownAt = this.clock();
    }
    this.publishPill();
    if (this.paused) this.timerRunningValue = false;
    else this.startPillTimer();
  }

  private obscurePill() {
    const kind = this.activePill;
    if (!kind) return;
    this.stopPillTimer();
    this.activePill = null;
    this.deferredPill = kind;
    this.deferredResumes = true;
    this.setPill({ kind: "hidden" });
  }

  private clearDeferred() {
    this.deferredPill = null;
    this.deferredResumes = false;
  }

  /** Runs the wall-clock timer down from pillRemainingMs, publishing at each whole second. */
  private startPillTimer() {
    this.pillJob?.cancel();
    this.pillJob = null;
    if (this.pillRemainingMs <= 0) {
      this.timerRunningValue = false;
      this.pillTimedOut();
      return;
    }
    this.timerRunningValue = true;
    const job = new Job(this.schedule);
    const step = () => {
      if (this.pillRemainingMs > 0) {
        this.publishPill();
        const delay = this.pillRemainingMs - (this.secondsFor(this.pillRemainingMs) - 1) * 1000;
        this.pillStepStartedAt = this.clock();
        job.after(delay, () => {
          this.pillRemainingMs -= Math.min(Math.max(this.clock() - this.pillStepStartedAt, 0), this.pillRemainingMs);
          step();
        });
        return;
      }
      job.finish();
      if (this.pillJob === job) this.pillJob = null;
      this.timerRunningValue = false;
      this.pillTimedOut();
    };
    this.pillJob = job;
    step();
  }

  private freezePill() {
    if (!this.pillJob?.active) return;
    this.stopPillTimer();
    this.publishPill();
  }

  private stopPillTimer() {
    const job = this.pillJob;
    if (job?.active) {
      this.pillRemainingMs -= Math.min(Math.max(this.clock() - this.pillStepStartedAt, 0), this.pillRemainingMs);
      job.cancel();
    }
    this.pillJob = null;
    this.timerRunningValue = false;
  }

  private thawPill() {
    if (this.activePill == null || this.pillJob != null) return;
    this.startPillTimer();
  }

  private pillTimedOut() {
    const kind = this.activePill;
    if (!kind) return;
    this.hidePill();
    if (kind === "undo") { this.undoEnded(); return; }
    // The prompt withdraws without an answer: history clears, a new trigger may offer after REOFFER_MIN_MS.
    const state = this.current;
    if (!state) return;
    state.action = "timed_out";
    this.reofferNotBefore = this.promptShownAt + REOFFER_MIN_MS;
    this.resetTracker(state, this.clock());
  }

  /** The undo's suppression ended: a stall in progress that reached LONG_STALL_MS is evaluated now. */
  private undoEnded() {
    const state = this.current;
    if (!state) return;
    const startedAt = state.tracker.stallStartedAt;
    if (startedAt == null) return;
    const now = this.clock();
    if (now - startedAt >= LONG_STALL_MS) this.evaluate(now);
  }

  private publishPill() {
    const seconds = this.secondsFor(this.pillRemainingMs);
    const kind = this.viewHidden ? null : this.activePill;
    this.setPill(kind === "prompt" ? { kind: "prompt", secondsRemaining: seconds }
      : kind === "undo" ? { kind: "undo", secondsRemaining: seconds }
      : { kind: "hidden" });
  }

  /** Takes any pill down, visible, waiting or hidden, deciding nothing. */
  private hidePill() {
    this.pillJob?.cancel();
    this.pillJob = null;
    this.activePill = null;
    this.clearDeferred();
    this.pillRemainingMs = 0;
    this.timerRunningValue = false;
    this.setPill({ kind: "hidden" });
  }

  /** Publishes the pill when it differs from what is shown (a StateFlow drops equal values). */
  private setPill(next: BufferingQualityPill) {
    const now = this.pillValue;
    const same = now.kind === next.kind && (next.kind === "hidden" || (now.kind !== "hidden" && now.secondsRemaining === next.secondsRemaining));
    if (same) return;
    this.pillValue = next;
    this.onPill(next);
  }

  private secondsFor(ms: number) { return Math.floor((ms + 999) / 1000); }
}

/** The step-down estimate a playback attempt's Auto was last lowered with. In memory only. */
export type KeptStepDownEstimate = { playbackAttemptId: string; kbps: number };

/** The replan fields the buffering-quality rules touch. */
export type BufferingReplanFields = {
  operation: string;
  playbackAttemptId: string;
  qualityPreference: string;
  bandwidthEstimateKbps?: number;
  bandwidthEstimateSource?: string;
  observedThroughputKbps?: number;
  learnedLimit?: string;
};

/** "original" and the like ask for the source, which Auto is now. */
const SOURCE_QUALITY_ALIASES = new Set(["auto", "original", "source", "max"]);

function videoQualityPreference(preference: string | undefined) {
  const normalized = preference?.trim().toLowerCase();
  if (!normalized) return null;
  return SOURCE_QUALITY_ALIASES.has(normalized) ? PLAYBACK_QUALITY_AUTO : normalized;
}

/**
 * Applies the kept-estimate rule (Android's `withKeptStepDownEstimate`) to one replan, right before
 * it is sent. `bufferingQuality` is the controller's replan, or null for one the client sends for
 * its own reasons (a track change, a seek reanchor, a recovery).
 *
 * - A lowering keeps its estimate, replacing any earlier one.
 * - Restore quality, and a quality_change the controller did not send, discard the attempt's estimate.
 * - Any other Auto request without an estimate of its own carries the kept one, without a source.
 */
export function withKeptStepDownEstimate<T extends BufferingReplanFields>(
  request: T,
  kept: KeptStepDownEstimate | null,
  bufferingQuality: BufferingQualityReplan | null
): { request: T; kept: KeptStepDownEstimate | null } {
  const observed = bufferingQuality?.bandwidthEstimateKbps;
  const discards = bufferingQuality?.learnedLimit === LEARNED_LIMIT_CLEAR ||
    (bufferingQuality == null && request.operation === "quality_change");
  if (discards) return { request, kept: kept && kept.playbackAttemptId === request.playbackAttemptId ? null : kept };
  if (observed != null) return { request, kept: { playbackAttemptId: request.playbackAttemptId, kbps: observed } };
  const repeat = kept && kept.playbackAttemptId === request.playbackAttemptId &&
    request.bandwidthEstimateKbps == null &&
    videoQualityPreference(request.qualityPreference) === PLAYBACK_QUALITY_AUTO;
  if (!repeat || !kept) return { request, kept };
  return {
    request: { ...request, bandwidthEstimateKbps: kept.kbps, bandwidthEstimateSource: undefined, observedThroughputKbps: undefined },
    kept
  };
}

/**
 * The estimate a playback start sends: the best measurement (the speed test or a playback sample)
 * and the learned limit, each at 80%, the lower of the two, then the admin cap. Null without a
 * measurement or a learned limit.
 */
export function connectionBudgetKbps(input: { probeKbps?: number | null; playbackSampleKbps?: number | null; learnedLimitKbps?: number | null; adminCapKbps?: number | null }): number | null {
  const measured = Math.max(input.probeKbps ?? 0, input.playbackSampleKbps ?? 0);
  const parts: number[] = [];
  if (measured > 0) parts.push(Math.floor((measured * 8) / 10));
  if (input.learnedLimitKbps != null && input.learnedLimitKbps > 0) parts.push(Math.floor((input.learnedLimitKbps * 8) / 10));
  if (!parts.length) return null;
  const budget = Math.min(...parts);
  return input.adminCapKbps != null && input.adminCapKbps > 0 ? Math.min(budget, input.adminCapKbps) : budget;
}
