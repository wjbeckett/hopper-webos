import { describe, expect, it } from "vitest";
import vectors from "./fixtures/buffering-quality-v1-vectors.json";
import {
  BufferingQualityController,
  connectionBudgetKbps,
  LEARNED_LIMIT_CLEAR,
  LONG_STALL_MS,
  MIN_ESTIMATE_KBPS,
  NO_LOWER_COOLDOWN_MS,
  PLAYBACK_QUALITY_AUTO,
  PROMPT_SECONDS,
  REARM_AFTER_UNADOPTED_MS,
  RENDERER_WAIT_BUFFER_MS,
  REOFFER_MIN_MS,
  STALL_MIN_MS,
  STALL_WINDOW_MS,
  STALLS_BEFORE_TRIGGER,
  STARTUP_GRACE_MS,
  STEP_DOWN_RATIO,
  withKeptStepDownEstimate,
  type BufferingPlanSummary,
  type BufferingQualityMode,
  type BufferingQualityPlan,
  type BufferingQualityReplan,
  type BufferingWaitCause,
  type KeptStepDownEstimate,
  type Schedule
} from "./bufferingQuality";

/*
 * Replays the Silo server's buffering-quality conformance vectors
 * (docs/design/schemas/buffering-quality/v1/vectors.json, vendored unchanged through the Android
 * client) as Android's BufferingQualityVectorsTest does. A failing case is a divergence from web,
 * Apple and Android, which replay the same file: fix the controller, never the vendored copy.
 */

type Json = Record<string, unknown>;
type Case = { name: string; mode?: string; events: Json[]; until: number; expect: Json[]; buffering_action?: Record<string, string> };

/** A fake clock and timer queue: timers due at or before a time run, in order, before an event at it. */
class FakeTime {
  now = 0;
  private seq = 0;
  private timers: Array<{ due: number; seq: number; action: () => void; live: boolean }> = [];
  readonly schedule: Schedule = (delayMs, action) => {
    const timer = { due: this.now + delayMs, seq: this.seq++, action, live: true };
    this.timers.push(timer);
    return () => { timer.live = false; };
  };
  advanceTo(t: number) {
    if (t < this.now) throw new Error(`event at ${t} is before the clock (${this.now})`);
    for (;;) {
      const next = this.timers.filter(timer => timer.live && timer.due <= t).sort((a, b) => a.due - b.due || a.seq - b.seq)[0];
      if (!next) break;
      next.live = false;
      this.now = next.due;
      next.action();
    }
    this.timers = this.timers.filter(timer => timer.live);
    this.now = t;
  }
}

const CLIENT_REPLAN_OPERATIONS = new Set(["track_change", "seek_reanchor", "seek_failure_recovery", "failure_recovery", "output_change"]);

/** The replans one playback sends, passed through the kept-estimate rule as the player sends them. */
class ClientReplans {
  private attempt = 1;
  private kept: KeptStepDownEstimate | null = null;
  adoptedQuality = PLAYBACK_QUALITY_AUTO;

  forController(replan: BufferingQualityReplan) {
    return this.send({
      operation: "quality_change",
      playbackAttemptId: `attempt-${this.attempt}`,
      qualityPreference: replan.qualityPreference,
      bandwidthEstimateKbps: replan.bandwidthEstimateKbps,
      bandwidthEstimateSource: replan.bandwidthEstimateSource,
      learnedLimit: replan.learnedLimit
    }, replan);
  }

  forClient(operation: string) {
    return this.send({ operation, playbackAttemptId: `attempt-${this.attempt}`, qualityPreference: this.adoptedQuality }, null);
  }

  newAttempt() { this.attempt += 1; }

  private send(request: Parameters<typeof withKeptStepDownEstimate>[0], bufferingQuality: BufferingQualityReplan | null) {
    const sent = withKeptStepDownEstimate(request, this.kept, bufferingQuality);
    this.kept = sent.kept;
    return sent.request;
  }
}

/** A sent replan as a vector output: the wire body, cut to the fields the vectors cover. */
function replanOutput(t: number, request: ReturnType<ClientReplans["forClient"]>) {
  const body: Json = { operation: request.operation, quality_preference: request.qualityPreference };
  if (request.bandwidthEstimateKbps != null) body.bandwidth_estimate_kbps = request.bandwidthEstimateKbps;
  if (request.bandwidthEstimateSource != null) body.bandwidth_estimate_source = request.bandwidthEstimateSource;
  if (request.learnedLimit != null) body.learned_limit = request.learnedLimit;
  return { t, type: "replan", body };
}

function planOf(plan: Json): BufferingQualityPlan {
  const warnings = (plan.degradation_warnings as string[] | undefined) ?? [];
  return {
    planId: String(plan.plan_id),
    deliveredKbps: typeof plan.delivered_kbps === "number" ? plan.delivered_kbps : null,
    quality: String(plan.quality),
    availableQualities: ((plan.available_qualities as Json[] | undefined) ?? []).map(rung => ({
      label: String(rung.label),
      bitrateKbps: typeof rung.bitrate_kbps === "number" ? rung.bitrate_kbps : 0
    })),
    qualityReductionUnavailable: warnings.includes("quality_reduction_unavailable"),
    activeQuality: typeof plan.active_quality === "string" ? plan.active_quality : null
  };
}

function causeOf(cause: unknown): BufferingWaitCause {
  if (cause == null) return "network";
  if (cause === "seek" || cause === "pause" || cause === "reload" || cause === "renderer") return cause;
  throw new Error(`unknown waiting cause ${String(cause)}`);
}

function replay(testCase: Case, defaultMode: string) {
  const time = new FakeTime();
  const outputs: Json[] = [];
  const summaries: BufferingPlanSummary[] = [];
  const replans = new ClientReplans();
  let previous = "hidden";
  const controller = new BufferingQualityController({
    clock: () => time.now,
    schedule: time.schedule,
    onReplan: replan => outputs.push(replanOutput(time.now, replans.forController(replan))),
    onNotice: notice => outputs.push({ t: time.now, type: "notice", key: notice }),
    onPlanSummary: summary => summaries.push(summary),
    onPill: pill => {
      if (pill.kind !== previous && pill.kind !== "hidden") outputs.push({ t: time.now, type: `${pill.kind}_shown` });
      previous = pill.kind;
    },
    // The vectors carry no throughput: every plan's media count as arriving below its bitrate.
    planThroughputKbps: () => 1
  });
  controller.setMode((testCase.mode ?? defaultMode) as BufferingQualityMode);

  for (const event of testCase.events) {
    time.advanceTo(Number(event.t));
    switch (event.type) {
      case "plan_adopted": {
        const plan = planOf(event.plan as Json);
        replans.adoptedQuality = plan.quality;
        controller.onPlanAdopted(plan, event.controllerInitiated === undefined ? true : Boolean(event.controllerInitiated));
        break;
      }
      case "client_replan": {
        const operation = String(event.operation);
        if (!CLIENT_REPLAN_OPERATIONS.has(operation)) throw new Error(`unknown client_replan operation ${operation}`);
        outputs.push(replanOutput(time.now, replans.forClient(operation)));
        break;
      }
      case "quality_changed":
        controller.onViewerQualityChange();
        replans.forClient("quality_change");
        break;
      case "new_attempt":
        controller.onNewAttempt();
        replans.newAttempt();
        break;
      case "pick_sent": controller.onQualityPickSent(); break;
      case "pick_refused": controller.onQualityPickRefused(); break;
      case "playing": controller.onPlaying(); break;
      case "waiting": controller.onWaiting(causeOf(event.cause)); break;
      case "pause": controller.onPause(); break;
      case "seek": controller.onSeek(); break;
      case "transport_error_start": controller.onTransportErrorStart(); break;
      case "transport_error_end": controller.onTransportErrorEnd(); break;
      case "replan_failed": controller.onReplanFailed(); break;
      case "select_lower": controller.selectLower(); break;
      case "select_keep": controller.selectKeep(); break;
      case "select_restore": controller.selectRestore(); break;
      case "back": controller.back(); break;
      case "pill_obscured": controller.setOtherPillVisible(true); break;
      case "pill_unobscured": controller.setOtherPillVisible(false); break;
      default: throw new Error(`unknown event type ${String(event.type)}`);
    }
  }
  time.advanceTo(testCase.until);
  expect(outputs).toEqual(testCase.expect);

  if (testCase.buffering_action) {
    controller.onPlaybackStopped();
    for (const [planId, action] of Object.entries(testCase.buffering_action)) {
      const summary = [...summaries].reverse().find(entry => entry.planId === planId);
      expect(summary, `no plan_summary for ${planId}`).toBeDefined();
      expect(summary!.action, `buffering_action for ${planId}`).toBe(action);
    }
  }
}

describe("buffering quality (Silo conformance vectors v1)", () => {
  const data = vectors as unknown as { constants: Record<string, number>; defaults: { mode: string }; copy: Record<string, string>; cases: Case[]; connection_budget_cases: Array<Record<string, number | string | null>> };

  it("uses the vectors' constants", () => {
    expect({
      STARTUP_GRACE_MS, STALL_MIN_MS, RENDERER_WAIT_BUFFER_MS, STALLS_BEFORE_TRIGGER, STALL_WINDOW_MS, LONG_STALL_MS,
      PROMPT_SECONDS, REOFFER_MIN_MS, NO_LOWER_COOLDOWN_MS, REARM_AFTER_UNADOPTED_MS, STEP_DOWN_RATIO, MIN_ESTIMATE_KBPS
    }).toEqual(data.constants);
    expect(data.defaults.mode).toBe("always");
    expect(Object.keys(data.copy)).toEqual(expect.arrayContaining(["lowered", "cant_lower"]));
    expect(LEARNED_LIMIT_CLEAR).toBe("clear");
  });

  for (const testCase of data.cases) {
    it(testCase.name, () => replay(testCase, data.defaults.mode));
  }

  for (const budget of data.connection_budget_cases) {
    it(`connection budget: ${String(budget.name)}`, () => {
      expect(connectionBudgetKbps({
        probeKbps: budget.probe_kbps as number | undefined,
        playbackSampleKbps: budget.playback_sample_kbps as number | undefined,
        learnedLimitKbps: budget.learned_limit_kbps as number | undefined,
        adminCapKbps: budget.admin_cap_kbps as number | undefined
      })).toBe(budget.expected_kbps);
    });
  }
});
