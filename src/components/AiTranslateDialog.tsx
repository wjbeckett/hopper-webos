import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AiTranslateStore } from "../core/aiTranslateJob";
import { languageDisplayName, languageOptions, languageSearchCode } from "../core/languageNames";
import type { AiStatus } from "../api/subtitles";

export type AiSource = { label: string; index: number; language: string };

const quotaPeriodText = (period: string) => ({ day: "today", week: "this week", month: "this month" } as Record<string, string>)[period.toLowerCase()] ?? `this ${period}`;

export function AiTranslateDialog({ store, status, subtitleSources, audioSources, defaultTargetLanguage, onClose }: {
  store: AiTranslateStore;
  status: AiStatus;
  subtitleSources: AiSource[];
  audioSources: AiSource[];
  defaultTargetLanguage: string;
  onClose: () => void;
}) {
  const { phase, quota, completedNonce } = useSyncExternalStore(store.subscribe, store.get);
  const subtitlesAvailable = status.enabled && subtitleSources.length > 0;
  const audioAvailable = status.transcribe_enabled && audioSources.length > 0;
  const canTranslateTranscript = status.enabled;
  const [mode, setMode] = useState<"subtitles" | "audio">(subtitlesAvailable ? "subtitles" : "audio");
  const [subtitlePos, setSubtitlePos] = useState(0);
  const [audioPos, setAudioPos] = useState(0);
  const [targetPos, setTargetPos] = useState(Math.max(0, languageOptions.findIndex(option => option.code === defaultTargetLanguage)));
  const root = useRef<HTMLElement>(null);
  const initialNonce = useRef(completedNonce);
  const cyclers = useRef<Record<string, (step: number) => void>>({});
  const live = useRef({ onClose });
  live.current = { onClose };

  useEffect(() => { void store.refreshQuota(); }, [store]);
  useEffect(() => { if (completedNonce !== initialNonce.current) onClose(); }, [completedNonce, onClose]);
  useEffect(() => {
    if (phase.kind === "submitting") return;
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-tv-focusable='true']:not([disabled])")?.focus());
  }, [phase.kind, mode, subtitlesAvailable, audioAvailable]);

  useEffect(() => {
    const isBack = (event: KeyboardEvent) => event.key === "Escape" || event.key === "Backspace" || event.keyCode === 461 || event.keyCode === 10009;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (isBack(event)) { if (!event.repeat) live.current.onClose(); return; }
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const list = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-tv-focusable='true']:not([disabled])") ?? []);
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const at = active ? list.indexOf(active) : -1;
        (at < 0 ? list[0] : list[Math.max(0, Math.min(list.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))])?.focus();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const key = active?.getAttribute("data-cycler");
        if (key) cyclers.current[key]?.(event.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (event.key === "Enter" || event.key === "OK") { if (!event.repeat) active?.click(); }
    };
    const onKeyUp = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => { window.removeEventListener("keydown", onKeyDown, true); window.removeEventListener("keyup", onKeyUp, true); };
  }, []);

  const wrap = (pos: number, step: number, size: number) => (pos + step + size) % size;
  const subtitleIndex = Math.min(subtitlePos, Math.max(0, subtitleSources.length - 1));
  const audioIndex = Math.min(audioPos, Math.max(0, audioSources.length - 1));
  cyclers.current = {
    mode: () => setMode(current => current === "subtitles" ? "audio" : "subtitles"),
    source: step => mode === "subtitles" ? setSubtitlePos(wrap(subtitleIndex, step, subtitleSources.length)) : setAudioPos(wrap(audioIndex, step, audioSources.length)),
    target: step => setTargetPos(wrap(targetPos, step, languageOptions.length))
  };
  const cycler = (key: string, title: string, value: string) => <button key={key} data-tv-focusable="true" data-cycler={key} className="option-row" onClick={() => cyclers.current[key](1)}><span>{title}</span><small>‹ {value} ›</small></button>;

  const quotaExhausted = mode === "audio" && quota?.limited === true && quota.remaining <= 0;
  function submit() {
    store.clearError();
    const targetLanguage = languageOptions[targetPos].code;
    if (mode === "subtitles") {
      const source = subtitleSources[subtitleIndex];
      void store.submit({ kind: "translate", sourceIndex: source.index, sourceLanguage: source.language, targetLanguage });
      return;
    }
    const source = audioSources[audioIndex];
    if (!canTranslateTranscript) { void store.submit({ kind: "transcribe", sourceIndex: source.index, sourceLanguage: source.language, targetLanguage: "" }); return; }
    const same = languageSearchCode(source.language) === targetLanguage;
    void store.submit({ kind: same ? "transcribe" : "transcribe_translate", sourceIndex: source.index, sourceLanguage: source.language, targetLanguage });
  }

  return <div className="subtitle-search-scrim" data-modal="true"><section className="subtitle-search" ref={root} role="dialog" aria-label="Translate with AI">
    <h2>TRANSLATE WITH AI</h2>
    {phase.kind === "running" ? <>
      <div className="ai-translate-title">Translating... {Math.floor(Math.min(1, Math.max(0, phase.progress)) * 100)}%</div>
      <div className="ai-translate-bar"><div style={{ width: `${Math.min(1, Math.max(0, phase.progress)) * 100}%` }} /></div>
      {phase.message.trim() ? <div className="ai-translate-message">{phase.message}</div> : null}
      <button data-tv-focusable="true" className="option-row" onClick={() => store.cancel()}><span>Cancel</span></button>
    </> : phase.kind === "submitting" ? <div className="ai-translate-message">Submitting...</div>
    : !subtitlesAvailable && !audioAvailable ? <>
      <div className="ai-translate-message">No translatable subtitle tracks, and audio transcription is not available on this server.</div>
      <button data-tv-focusable="true" className="option-row" onClick={onClose}><span>Close</span></button>
    </> : <>
      {subtitlesAvailable && audioAvailable ? cycler("mode", "Mode", mode === "subtitles" ? "From subtitles" : "From audio") : null}
      {mode === "subtitles" ? cycler("source", "Source subtitle", subtitleSources[subtitleIndex].label) : cycler("source", "Source audio", audioSources[audioIndex].label)}
      {mode === "subtitles" || canTranslateTranscript ? cycler("target", "Target language", languageDisplayName(languageOptions[targetPos].code)) : <div className="ai-translate-message">Subtitles are written in the spoken language. AI translation is turned off on this server.</div>}
      {mode === "audio" && quota?.limited ? <div className="ai-translate-message" style={quotaExhausted ? { color: "#F59E0B" } : undefined}>{quotaExhausted ? `Transcription quota exhausted (${quota.used} of ${quota.limit} used ${quotaPeriodText(quota.period)})` : `${quota.remaining} of ${quota.limit} transcriptions left ${quotaPeriodText(quota.period)}`}</div> : null}
      {phase.kind === "failed" ? <div className="subtitle-search-error">{phase.message}</div> : null}
      <button data-tv-focusable="true" className="option-row" aria-disabled={quotaExhausted} onClick={() => { if (!quotaExhausted) submit(); }}><span>{mode === "subtitles" ? "Translate" : "Transcribe"}</span></button>
    </>}
  </section></div>;
}
