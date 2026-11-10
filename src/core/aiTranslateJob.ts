import { apiErrorMessage, apiErrorStatus, cancelAiJob, getAiJob, getAiQuota, startAiTranslate, type AiKind, type AiQuota } from "../api/subtitles";
import type { Session } from "../types";

export type AiPhase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "running"; progress: number; message: string }
  | { kind: "failed"; message: string };
export type AiState = { phase: AiPhase; quota: AiQuota | null; completedNonce: number };
export type AiSubmit = { kind: AiKind; sourceIndex: number; sourceLanguage: string; targetLanguage: string };

const POLL_MS = 1000;

export function createAiTranslateStore(session: Session, mediaFileId: number, position: () => number, onCompleted: () => Promise<boolean>) {
  let state: AiState = { phase: { kind: "idle" }, quota: null, completedNonce: 0 };
  const listeners = new Set<() => void>();
  let generation = 0;
  let activeJob: string | null = null;
  let disposed = false;
  const set = (patch: Partial<AiState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  async function refreshQuota() {
    try { const quota = await getAiQuota(session); if (!disposed) set({ quota }); } catch { /* quota line stays hidden */ }
  }

  async function submit(request: AiSubmit) {
    if (state.phase.kind === "submitting" || state.phase.kind === "running") return;
    const mine = ++generation;
    set({ phase: { kind: "submitting" } });
    let jobId: string;
    try {
      const response = await startAiTranslate(session, { mediaFileId, ...request, startPosition: position() });
      if (disposed || mine !== generation) return;
      jobId = response.job.id;
      activeJob = jobId;
      set({ phase: { kind: "running", progress: response.job.progress, message: response.job.progress_message || (response.live_delivery_attached ? "" : "Processing in background") } });
    } catch (reason) {
      if (disposed || mine !== generation) return;
      if (apiErrorStatus(reason) === 429) void refreshQuota();
      set({ phase: { kind: "failed", message: apiErrorMessage(reason, "Translation failed") } });
      return;
    }
    while (!disposed && mine === generation) {
      await wait(POLL_MS);
      if (disposed || mine !== generation) return;
      let job;
      try { job = (await getAiJob(session, jobId)).job; } catch (reason) {
        if (apiErrorStatus(reason) === 404) { activeJob = null; set({ phase: { kind: "failed", message: "This job no longer exists on the server." } }); return; }
        continue;
      }
      if (disposed || mine !== generation) return;
      set({ phase: { kind: "running", progress: job.progress, message: job.progress_message } });
      if (job.status === "completed") {
        activeJob = null;
        const merged = await onCompleted();
        if (disposed || mine !== generation) return;
        if (merged) set({ phase: { kind: "idle" }, completedNonce: state.completedNonce + 1 });
        else set({ phase: { kind: "failed", message: "Translated, but the subtitle list could not be refreshed." } });
        return;
      }
      if (job.status === "failed") { activeJob = null; set({ phase: { kind: "failed", message: job.error_message || "Translation failed" } }); return; }
      if (job.status === "cancelled") { activeJob = null; set({ phase: { kind: "idle" } }); return; }
    }
  }

  function cancel() {
    const jobId = activeJob;
    generation += 1;
    activeJob = null;
    set({ phase: { kind: "idle" } });
    if (jobId) void cancelAiJob(session, jobId).catch(() => undefined);
  }

  return {
    get: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    submit, cancel, refreshQuota,
    clearError: () => { if (state.phase.kind === "failed") set({ phase: { kind: "idle" } }); },
    dispose: () => { disposed = true; generation += 1; listeners.clear(); }
  };
}
export type AiTranslateStore = ReturnType<typeof createAiTranslateStore>;
