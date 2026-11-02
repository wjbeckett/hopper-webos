import { useEffect, useRef, useState } from "react";
import { downloadSubtitle, searchSubtitles, type SubtitleSearchResult } from "../api/subtitles";
import { languageDisplayName, languageOptions } from "../core/languageNames";
import type { Session } from "../types";

const scoreColor = (score: number) => score >= 70 ? "#22C55E" : score >= 40 ? "#EAB308" : "#EF4444";
const providerChip = (provider: string): { label: string; color: string } => {
  const key = provider.trim().toLowerCase();
  if (key === "opensubtitles" || key === "os" || key === "opensubtitles.com") return { label: "OS", color: "#EAB308" };
  if (key === "subdl" || key === "sdl") return { label: "SDL", color: "#3B82F6" };
  if (key === "subsource" || key === "ss") return { label: "SS", color: "#EF4444" };
  return { label: provider.slice(0, 3).toUpperCase(), color: "rgba(255,255,255,.40)" };
};

export function SubtitleSearchDialog({ session, mediaFileId, defaultLanguage, onClose, onDownloaded }: {
  session: Session;
  mediaFileId: number;
  defaultLanguage: string;
  onClose: () => void;
  onDownloaded: (subtitleId: string) => Promise<boolean>;
}) {
  const [language, setLanguage] = useState(defaultLanguage);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<SubtitleSearchResult[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const live = useRef({ language, searching, downloading, onClose });
  live.current = { language, searching, downloading, onClose };
  const generation = useRef(0);

  useEffect(() => {
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-search-language]")?.focus());
    return () => { generation.current += 1; };
  }, []);

  function cycleLanguage(step: number) {
    const index = languageOptions.findIndex(option => option.code === live.current.language);
    const next = languageOptions[(Math.max(0, index) + step + languageOptions.length) % languageOptions.length];
    setLanguage(next.code);
  }

  async function runSearch() {
    if (live.current.searching) return;
    setSearching(true); setError(""); setWarnings([]);
    const mine = ++generation.current;
    try {
      const response = await searchSubtitles(session, mediaFileId, live.current.language);
      if (mine !== generation.current) return;
      setResults(response.results ?? []); setWarnings(response.warnings ?? []); setSearched(true);
    } catch (reason) {
      if (mine !== generation.current) return;
      setError(reason instanceof Error && reason.message ? reason.message : "Subtitle search failed");
    } finally { if (mine === generation.current) setSearching(false); }
  }

  async function runDownload(result: SubtitleSearchResult) {
    if (live.current.downloading) return;
    setDownloading(result.id); setError("");
    const mine = ++generation.current;
    try {
      const response = await downloadSubtitle(session, mediaFileId, result);
      if (mine !== generation.current) return;
      const merged = await onDownloaded(response.subtitle.id);
      if (mine !== generation.current) return;
      if (merged) live.current.onClose();
      else { setDownloading(null); setError("Downloaded, but the subtitle list could not be refreshed."); }
    } catch (reason) {
      if (mine !== generation.current) return;
      setDownloading(null);
      setError(reason instanceof Error && reason.message ? reason.message : "Subtitle download failed");
    }
  }

  useEffect(() => {
    const isBack = (event: KeyboardEvent) => event.key === "Escape" || event.key === "Backspace" || event.keyCode === 461 || event.keyCode === 10009;
    const rows = () => Array.from(root.current?.querySelectorAll<HTMLElement>("[data-tv-focusable='true']:not([disabled])") ?? []);
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (isBack(event)) { if (!event.repeat) live.current.onClose(); return; }
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const list = rows();
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const at = active ? list.indexOf(active) : -1;
        const next = at < 0 ? list[0] : list[Math.max(0, Math.min(list.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
        next?.focus();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (active?.hasAttribute("data-search-language")) cycleLanguage(event.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (event.key === "Enter" || event.key === "OK") { if (!event.repeat) active?.click(); }
    };
    const onKeyUp = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => { window.removeEventListener("keydown", onKeyDown, true); window.removeEventListener("keyup", onKeyUp, true); };
  }, []);

  return <div className="subtitle-search-scrim" data-modal="true"><section className="subtitle-search" ref={root} role="dialog" aria-label="Search subtitles">
    <h2>SEARCH SUBTITLES</h2>
    <button data-tv-focusable="true" data-search-language className="option-row subtitle-search-language" onClick={() => cycleLanguage(1)}><span>Language</span><small>‹ {languageDisplayName(language)} ›</small></button>
    <button data-tv-focusable="true" className="option-row" disabled={searching || downloading != null} onClick={() => void runSearch()}><span>{searching ? "Searching..." : "Search"}</span></button>
    {error ? <div className="subtitle-search-error">{error}</div> : null}
    {warnings.map(warning => <div key={warning} className="subtitle-search-warning">{warning}</div>)}
    {searched && !error && results.length === 0 ? <div className="subtitle-search-empty">No subtitles found</div> : null}
    {results.length ? <div className="subtitle-search-results">{results.map(result => {
      const chip = providerChip(result.provider);
      return <button key={`${result.provider}:${result.id}`} data-tv-focusable="true" className="option-row subtitle-search-result" disabled={downloading != null && downloading !== result.id} onClick={() => void runDownload(result)}>
        <b className="subtitle-search-score" style={{ background: scoreColor(result.score) }}>{Math.round(result.score)}</b>
        <span className="subtitle-search-body"><span className="subtitle-search-release">{result.release_name || "Unnamed release"}</span><span className="subtitle-search-meta"><i style={{ background: chip.color }}>{chip.label}</i>{result.hearing_impaired ? <i className="subtitle-search-hi">HI</i> : null}<em>{result.downloads} downloads · {languageDisplayName(result.language)}</em></span></span>
        {downloading === result.id ? <span className="loading-spinner subtitle-search-spinner" aria-label="Downloading" /> : null}
      </button>;
    })}</div> : null}
  </section></div>;
}
