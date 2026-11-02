import { apiErrorMessage, apiErrorStatus, getSyncCapability, readSubtitleSync, resetSubtitleTiming, startSubtitleSync, type SubtitleSyncJob, type SubtitleSyncState, type SubtitleTiming } from "../api/subtitles";
import type { Session } from "../types";

export type SyncEntry = { state: SubtitleSyncState; busy: boolean; forbidden: boolean; unsupported: boolean; error: string | null; pollExpired: boolean };
export type SyncUiState = { available: boolean; externalAvailable: boolean; entries: Record<string, SyncEntry> };
export type TimingActions = {
  key: string; statusLabel: string | null; canSync: boolean; canReset: boolean; inProgress: boolean; percent: number | null; phaseLabel: string | null;
  result: { text: string; warning: boolean } | null; note: string | null; busy: boolean; forbidden: boolean; error: string | null;
};

export const FORBIDDEN_MESSAGE = "This server doesn't allow changing subtitle timing.";
const SIDECAR_NOTE = "Matches the timing to the audio for everyone. The file itself isn't changed.";
const STORED_NOTE = "Matches the timing to the audio for everyone watching.";
const POLL_INTERVAL_MS = 3000;
const POLL_LIMIT_MS = 5 * 60_000;

const isIdentity = (timing: SubtitleTiming) => timing.offset_ms === 0 && timing.scale === 1;
const sameTiming = (a: SubtitleTiming, b?: SubtitleTiming) => Boolean(b) && a.offset_ms === b!.offset_ms && a.scale === b!.scale;
const inProgressJob = (job?: SubtitleSyncJob | null) => job?.status === "pending" || job?.status === "running";

function formatOffset(offsetMs: number) {
  const tenths = Math.floor((Math.abs(offsetMs) + 50) / 100);
  return `${offsetMs < 0 ? "−" : "+"}${Math.floor(tenths / 10)}.${tenths % 10} s`;
}
const FRAME_RATES: Array<[number, string]> = [[23.976, "23.976"], [24, "24"], [25, "25"], [29.97, "29.97"], [30, "30"], [50, "50"], [59.94, "59.94"], [60, "60"]];
function describeScale(scale: number) {
  if (!Number.isFinite(scale) || scale === 1) return null;
  for (const [from, fromLabel] of FRAME_RATES) for (const [to, toLabel] of FRAME_RATES) if (from !== to && Math.abs(from / to - scale) <= 1e-6) return `${fromLabel}→${toLabel} fps`;
  return `×${Number(scale.toFixed(4))} speed`;
}
function describeTiming(timing: SubtitleTiming) {
  const scale = describeScale(timing.scale);
  return [timing.offset_ms !== 0 || scale == null ? formatOffset(timing.offset_ms) : null, scale].filter(Boolean).join(" · ");
}
const progressPercent = (job?: SubtitleSyncJob | null) => job && inProgressJob(job) ? Math.round(Math.min(1, Math.max(0, job.progress ?? 0)) * 100) : null;
const phaseLabel = (job?: SubtitleSyncJob | null) => !job || !inProgressJob(job) ? null : job.phase === "matching" ? "Matching lines to speech..." : job.phase === "analyzing" ? "Listening to the audio..." : "Waiting to start...";
const failureMessage = (failure?: string) => failure === "subtitle_changed" ? "The subtitle changed while it was syncing. Try again." : failure === "no_audio" ? "This video has no audio Silo can read." : failure === "unavailable" ? "The server is busy. Try again in a few minutes." : "Sync failed. Try again.";

function statusLabel(timing: SubtitleTiming, sync?: SubtitleSyncJob | null): string | null {
  switch (sync?.status) {
    case "pending": case "running": { const percent = progressPercent(sync); return percent != null && percent > 0 ? `Syncing... ${percent}%` : "Syncing..."; }
    case "no_match": return "Doesn't match this video";
    case "failed": return "Sync failed";
    case "already_synced": if (isIdentity(timing)) return "Already in sync"; break;
    case "synced": if (isIdentity(timing)) return "Original timing"; if (sameTiming(timing, sync.result)) return `Synced ${describeTiming(timing)}`; break;
  }
  return isIdentity(timing) ? null : `Timing adjusted ${describeTiming(timing)}`;
}
function resultLine(timing: SubtitleTiming, sync?: SubtitleSyncJob | null): { text: string; warning: boolean } | null {
  switch (sync?.status) {
    case "synced": return isIdentity(timing) ? null : { text: `Synced to the audio: ${describeTiming(timing)}`, warning: false };
    case "already_synced": return { text: "Already matches the audio.", warning: false };
    case "no_match": return { text: "Doesn't match this video's audio; probably for another release.", warning: true };
    case "failed": return { text: failureMessage(sync.failure), warning: true };
  }
  return null;
}

export function timingActionsFor(state: SyncUiState, key: string | undefined | null): TimingActions | null {
  const entry = key ? state.entries[key] : undefined;
  if (!entry) return null;
  const sidecar = entry.state.source === "external";
  const canSync = state.available && !entry.unsupported && (!sidecar || state.externalAvailable);
  const canReset = !isIdentity(entry.state.timing);
  if (!entry.forbidden && !canSync && !canReset && entry.error == null) return null;
  const job = entry.state.sync;
  const inProgress = inProgressJob(job);
  const result = inProgress || entry.error != null ? null : resultLine(entry.state.timing, job);
  return {
    key: entry.state.key, statusLabel: statusLabel(entry.state.timing, job), canSync, canReset, inProgress, percent: progressPercent(job), phaseLabel: phaseLabel(job), result,
    note: entry.forbidden || !canSync || inProgress || result ? null : sidecar ? SIDECAR_NOTE : STORED_NOTE,
    busy: entry.busy, forbidden: entry.forbidden, error: entry.error
  };
}

export function timingValue(timing: TimingActions) {
  return timing.forbidden ? "Not allowed" : timing.busy ? "Working..." : timing.error ?? timing.statusLabel ?? "Not synced";
}

export function createSubtitleSyncStore(session: Session, mediaFileId: number, onTimingChanged: (key: string) => void) {
  let state: SyncUiState = { available: false, externalAvailable: false, entries: {} };
  const listeners = new Set<() => void>();
  const loadedTiming = new Map<string, SubtitleTiming>();
  const polledMs = new Map<string, number>();
  let disposed = false;
  let polling = false;
  const emit = () => listeners.forEach(listener => listener());
  const patch = (key: string, change: (entry: SyncEntry) => SyncEntry) => {
    const entry = state.entries[key];
    if (!entry) return;
    state = { ...state, entries: { ...state.entries, [key]: change(entry) } };
    emit();
  };

  function observe(next: SubtitleSyncState) {
    const key = next.key;
    const previous = loadedTiming.get(key);
    loadedTiming.set(key, next.timing);
    if (!inProgressJob(next.sync)) polledMs.delete(key);
    const entry = state.entries[key] ?? { state: next, busy: false, forbidden: false, unsupported: false, error: null, pollExpired: false };
    state = { ...state, entries: { ...state.entries, [key]: { ...entry, state: next, pollExpired: inProgressJob(next.sync) && entry.pollExpired } } };
    emit();
    if (previous && (previous.offset_ms !== next.timing.offset_ms || previous.scale !== next.timing.scale)) onTimingChanged(key);
  }

  function fail(key: string, reason: unknown, fallback: string) {
    const status = apiErrorStatus(reason);
    patch(key, entry => status === 403 ? { ...entry, busy: false, forbidden: true, error: null }
      : status === 422 ? { ...entry, busy: false, unsupported: true, error: "This format can't be synced." }
      : status === 412 ? { ...entry, busy: false, error: "The subtitle changed. Try again." }
      : { ...entry, busy: false, error: apiErrorMessage(reason, fallback) });
  }

  const pollable = () => Object.values(state.entries).filter(entry => inProgressJob(entry.state.sync) && !entry.pollExpired).map(entry => entry.state.key);
  async function startPolling() {
    if (polling) return;
    polling = true;
    while (!disposed && pollable().length) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      for (const key of pollable()) {
        if (disposed) break;
        const polled = (polledMs.get(key) ?? 0) + POLL_INTERVAL_MS;
        polledMs.set(key, polled);
        if (polled > POLL_LIMIT_MS) { polledMs.delete(key); patch(key, entry => ({ ...entry, pollExpired: true })); continue; }
        try { const next = await readSubtitleSync(session, mediaFileId, key); if (!disposed) observe(next); }
        catch (reason) { if (apiErrorStatus(reason) !== 0 && !disposed) patch(key, entry => ({ ...entry, pollExpired: true })); }
      }
    }
    polling = false;
  }

  async function reload(keys: string[]) {
    polledMs.clear();
    const [capability, ...reads] = await Promise.all([
      getSyncCapability(session).catch(() => null),
      ...keys.map(key => readSubtitleSync(session, mediaFileId, key).catch(() => null))
    ]);
    if (disposed) return;
    if (capability) state = { ...state, available: capability.state === "available" && capability.allowed, externalAvailable: capability.state === "available" && capability.allowed && capability.external };
    reads.forEach(read => { if (read) observe(read); });
    emit();
    void startPolling();
  }

  async function requestSync(key: string) {
    if (state.entries[key]?.busy !== false) return;
    polledMs.delete(key);
    patch(key, entry => ({ ...entry, busy: true, error: null, pollExpired: false }));
    try { observe(await startSubtitleSync(session, mediaFileId, key)); patch(key, entry => ({ ...entry, busy: false })); void startPolling(); }
    catch (reason) { fail(key, reason, "Sync failed"); }
  }

  async function resetTiming(key: string) {
    if (state.entries[key]?.busy !== false) return;
    patch(key, entry => ({ ...entry, busy: true, error: null }));
    try { observe(await resetSubtitleTiming(session, mediaFileId, key)); patch(key, entry => ({ ...entry, busy: false })); }
    catch (reason) { fail(key, reason, "Couldn't reset timing"); }
  }

  return {
    get: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload, requestSync, resetTiming,
    dispose: () => { disposed = true; listeners.clear(); }
  };
}
export type SubtitleSyncStore = ReturnType<typeof createSubtitleSyncStore>;

export function delaySecondsLabel(valueMs: number) {
  const seconds = (Math.abs(valueMs) / 1000).toFixed(1);
  return valueMs > 0 ? `+${seconds} s` : valueMs < 0 ? `−${seconds} s` : `${seconds} s`;
}
