import { useEffect, useRef, useState } from "react";
import { saveAudioChoice, saveSubtitleChoice } from "../api/playback";
import type { AudioTrack, FileVersion, PlaybackChoices, SubtitleTrack, WatchDetail } from "../api/playback";
import { getWatchDetail, prewarmPlayback } from "../api/playback";
import type { Session, SiloItem } from "../types";
import { LoadingState } from "./LoadingState";

const languageNames: Record<string, string> = {
  en: "English", eng: "English", nl: "Dutch", nld: "Dutch", dut: "Dutch",
  de: "German", deu: "German", ger: "German", fr: "French", fra: "French", fre: "French",
  es: "Spanish", spa: "Spanish", it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese",
  ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean", zh: "Chinese", zho: "Chinese", chi: "Chinese"
};

const VIDEO_CODECS: Record<string, string> = {
  "h.264": "H.264", h264: "H.264", avc: "AVC", hevc: "HEVC", "h.265": "H.265", h265: "H.265",
  dvh1: "HEVC", dvhe: "HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8", mpeg2video: "MPEG-2", mpeg4: "MPEG-4"
};

const AUDIO_CODECS: Record<string, string> = {
  eac3: "EAC3", ec3: "EAC3", truehd: "TrueHD", ac3: "AC3", ac4: "AC4", dts: "DTS",
  "dts-hd": "DTS-HD", "dts-hd ma": "DTS-HD MA", dtshd: "DTS-HD", flac: "FLAC",
  aac: "AAC", mp3: "MP3", opus: "Opus", vorbis: "Vorbis", pcm: "PCM"
};

function cleanLanguage(code?: string) {
  const key = code?.trim().toLowerCase();
  return key && key !== "und" && key !== "undetermined" ? key : undefined;
}

function languageName(code?: string) {
  const key = cleanLanguage(code);
  return key ? languageNames[key] ?? key.toUpperCase() : undefined;
}

function videoCodecLabel(codec?: string) {
  const key = codec?.trim().toLowerCase();
  return key ? VIDEO_CODECS[key] ?? codec!.trim().toUpperCase() : undefined;
}

function audioCodecLabel(codec?: string) {
  const key = codec?.trim().toLowerCase();
  return key ? AUDIO_CODECS[key] ?? codec!.trim().toUpperCase() : undefined;
}

function displayResolution(value?: string) {
  const token = value?.trim();
  if (!token) return undefined;
  const lowered = token.toLowerCase();
  if (lowered.includes("4320") || lowered.includes("8k")) return "8K";
  if (lowered.includes("2160") || lowered === "4k" || lowered.includes("uhd")) return "4K";
  return token.toUpperCase();
}

function isDolbyVision(version: FileVersion) {
  const codec = version.codec_video?.trim().toLowerCase() ?? "";
  return codec === "dvh1" || codec === "dvhe" || codec.includes("dolby") || codec.includes("dv");
}

function isHdr(version: FileVersion) {
  return [version.resolution, version.codec_video].some(value => value?.toLowerCase().includes("hdr")) ?? false;
}

function audioLayout(track: AudioTrack) {
  const layout = track.layout?.trim().toLowerCase();
  if (layout) {
    if (layout.includes("atmos")) return "Atmos";
    if (layout.includes("7.1")) return "7.1";
    if (layout.includes("5.1")) return "5.1";
    if (layout.includes("stereo")) return "Stereo";
    return track.layout!.trim();
  }
  switch (track.channels) {
    case 1: return "Mono";
    case 2: return "Stereo";
    case 6: return "5.1";
    case 8: return "7.1";
    default: return undefined;
  }
}

export function audioTitle(track: AudioTrack, ordinal: number) {
  return languageName(track.language) ?? track.title?.trim() ?? track.embedded_title?.trim() ?? `Track ${ordinal + 1}`;
}

function audioSummary(track: AudioTrack, ordinal: number) {
  const tokens = [languageName(track.language), audioCodecLabel(track.codec), audioLayout(track)];
  return tokens.filter(Boolean).join(" · ") || audioTitle(track, ordinal);
}

function audioRowDetail(track: AudioTrack, ordinal: number) {
  const title = track.title?.trim() ?? track.embedded_title?.trim();
  return [
    title && title !== audioTitle(track, ordinal) ? title : "",
    audioCodecLabel(track.codec),
    audioLayout(track),
    track.default ? "Default" : ""
  ].filter(Boolean).join(" · ");
}

export function audioValueLabel(version: FileVersion | undefined, ordinal?: number) {
  const track = version && ordinal != null ? version.audio_tracks?.[ordinal] : undefined;
  return track && ordinal != null ? audioSummary(track, ordinal) : "Auto";
}

function meaningfulSubtitleTitle(track: SubtitleTrack) {
  const title = track.title?.trim() ?? track.embedded_title?.trim();
  if (!title) return undefined;
  const lowered = title.toLowerCase();
  if (track.language && lowered === track.language.trim().toLowerCase()) return undefined;
  if (/^(forced|sdh|hearing impaired|default|external)$/.test(lowered)) return undefined;
  return title;
}

function subtitleTitle(track: SubtitleTrack, ordinal: number) {
  return languageName(track.language) ?? meaningfulSubtitleTitle(track) ?? `Track ${ordinal + 1}`;
}

function subtitleRowDetail(track: SubtitleTrack) {
  return [
    meaningfulSubtitleTitle(track),
    track.codec?.trim().toUpperCase(),
    track.forced ? "Forced" : "",
    track.hearing_impaired ? "SDH" : "",
    track.default ? "Default" : "",
    track.external ? "External" : ""
  ].filter(Boolean).join(" · ");
}

export function combinedSubtitleIndexes(tracks: SubtitleTrack[]) {
  const withIndex = tracks.filter(track => track.index != null);
  if (withIndex.length === tracks.length && tracks.length > 0) return tracks.map(track => track.index!);
  const externalCount = tracks.filter(track => track.external).length;
  let externals = 0;
  let embedded = 0;
  return tracks.map(track => (track.external ? externals++ : externalCount + embedded++));
}

export function subtitleValueLabel(version: FileVersion | undefined, index?: number, off?: boolean) {
  if (off) return "Off";
  const tracks = version?.subtitle_tracks ?? [];
  const at = index == null ? -1 : combinedSubtitleIndexes(tracks).indexOf(index);
  const track = at >= 0 ? tracks[at] : undefined;
  if (!track) return "Auto";
  let name = subtitleTitle(track, at);
  if (track.hearing_impaired && !/sdh/i.test(name)) name += " (SDH)";
  if (track.forced && !name.toLowerCase().includes("forced")) name += " (Forced)";
  return name;
}

export function versionShortLabel(version: FileVersion) {
  const tokens = [
    displayResolution(version.resolution),
    videoCodecLabel(version.codec_video),
    isDolbyVision(version) ? "DV" : isHdr(version) ? "HDR" : undefined,
    audioCodecLabel(version.codec_audio)
  ];
  return tokens.filter(Boolean).join(" · ") || `File ${version.file_id}`;
}

export function versionValueLabel(version: FileVersion | undefined, selectedFileId?: number) {
  const detail = version ? versionShortLabel(version) : "Auto";
  return selectedFileId == null ? (version ? `Auto: ${detail}` : "Auto") : detail;
}

export type PlaybackEdition = { id: string; label: string; versions: FileVersion[]; fileIds: number[] };

export function editionLabel(raw?: string, key?: string) {
  const clean = raw?.trim();
  if (clean) return clean;
  const fromKey = key?.trim();
  if (fromKey) {
    return fromKey.split(/[_-]+/).filter(Boolean)
      .map(part => (part.toLowerCase() === "imax" ? "IMAX" : part.charAt(0).toUpperCase() + part.slice(1)))
      .join(" ");
  }
  return undefined;
}

export function playbackEditions(versions: FileVersion[]): PlaybackEdition[] {
  const groups = new Map<string, FileVersion[]>();
  for (const version of versions) {
    const label = editionLabel(version.edition_raw, version.edition_key);
    const key = version.edition_key?.trim() || label || "";
    const list = groups.get(key) ?? [];
    list.push(version);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([id, files]) => ({
    id,
    label: editionLabel(files[0].edition_raw, files[0].edition_key) ?? "Standard",
    versions: files,
    fileIds: files.map(file => file.file_id)
  }));
}

export function hasEditionChoices(editions: PlaybackEdition[]) {
  return editions.length > 1 && new Set(editions.map(edition => edition.label.toLowerCase())).size > 1;
}

export function choiceSummary(detail: WatchDetail | null, choices: PlaybackChoices) {
  const versions = detail?.versions ?? [];
  const scoped = hasEditionChoices(playbackEditions(versions));
  const current = versions.find(version => version.file_id === choices.fileId) ?? versions[0];
  const versionId = scoped ? choices.fileId ?? current?.file_id : choices.fileId;
  return {
    version: versionValueLabel(current, versionId),
    audio: audioValueLabel(current, choices.audioIndex),
    subtitles: subtitleValueLabel(current, choices.subtitleIndex, choices.subtitleOff)
  };
}

export function useWatchDetail(session: Session, item: SiloItem | undefined) {
  const [detail, setDetail] = useState<WatchDetail | null>(null);
  const id = item?.Id;
  useEffect(() => {
    if (!item) { setDetail(null); return; }
    let alive = true;
    setDetail(null);
    // Fresh read on open (resume position may have moved); the player then reuses this response.
    getWatchDetail(session, item, { fresh: true }).then(next => { if (alive) setDetail(next); }).catch(() => undefined);
    // Play is likely next: settle the installation id and load the HLS module now.
    prewarmPlayback(session);
    return () => { alive = false; };
  }, [session, id]);
  return detail;
}

const summaryLabels = ["VERSION", "AUDIO", "SUBTITLES"] as const;

export function PlaybackSummary({ detail, choices }: { detail: WatchDetail | null; choices: PlaybackChoices }) {
  // Retain the last rendered values while the next episode's detail resolves,
  // so the row neither collapses nor reflows (mirrors Android's
  // TvPlaybackSummary, which keeps the previous presentation during the
  // transition). Skeleton bars show only before the first value arrives.
  const lastValues = useRef<[string, string, string] | null>(null);
  const summary = choiceSummary(detail, choices);
  const values: [string, string, string] | null = detail ? [summary.version, summary.audio, summary.subtitles] : null;
  if (values) lastValues.current = values;
  const shown = values ?? lastValues.current;
  return (
    <div className="playback-summary">
      {summaryLabels.map((label, at) => (
        <span key={label}>
          <em>{label}</em>
          {shown ? shown[at] : <i className="playback-summary-loading" aria-hidden="true" />}
        </span>
      ))}
    </div>
  );
}

export function PlaybackOptionsDialog({ session, detail, choices, onChange, onClose }: {
  session: Session;
  detail: WatchDetail | null;
  choices: PlaybackChoices;
  onChange: (next: PlaybackChoices) => void;
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => firstRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (!["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) && event.keyCode !== 461 && event.keyCode !== 10009) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const versions = detail?.versions ?? [];
  const editions = playbackEditions(versions);
  const scoped = hasEditionChoices(editions);
  const active = versions.find(version => version.file_id === choices.fileId) ?? versions[0];
  const scopedFileId = choices.fileId ?? active?.file_id;
  const edition = scoped
    ? editions.find(entry => scopedFileId != null && entry.fileIds.includes(scopedFileId)) ?? editions[0]
    : undefined;
  const rowsFor = scoped ? edition?.versions ?? [] : versions;
  const seriesKey = detail?.series_id ?? detail?.content_id;
  const audioTracks = active?.audio_tracks ?? [];
  const subtitleTracks = active?.subtitle_tracks ?? [];
  const subtitleSelections = combinedSubtitleIndexes(subtitleTracks);

  function apply(next: PlaybackChoices) {
    if (seriesKey) {
      const target = versions.find(version => version.file_id === (next.fileId ?? active?.file_id));
      if (next.audioIndex !== choices.audioIndex && next.audioIndex != null) {
        const track = target?.audio_tracks?.[next.audioIndex];
        if (track) void saveAudioChoice(session, seriesKey, track, next.audioIndex).catch(() => undefined);
      }
      if (next.subtitleIndex !== choices.subtitleIndex || next.subtitleOff !== choices.subtitleOff) {
        const tracks = target?.subtitle_tracks ?? [];
        const at = next.subtitleIndex == null ? -1 : next.subtitleIndex;
        const track = at >= 0 ? tracks[at] : undefined;
        void saveSubtitleChoice(session, seriesKey, next.subtitleOff ? undefined : track, next.subtitleOff ? -1 : next.subtitleIndex == null ? -1 : at).catch(() => undefined);
      }
    }
    onChange(next);
  }

  let first = true;
  const row = (selected: boolean, title: string, detailLine: string, onPick: () => void, key: string) => {
    const ref = first ? firstRef : undefined;
    first = false;
    return (
      <button key={key} ref={ref} type="button" data-tv-focusable="true" className={`browse-panel-row ${selected ? "selected" : ""}`} onClick={onPick}>
        <span className="browse-panel-check">{selected ? "✓" : ""}</span>
        <span className="browse-panel-row-copy">
          <span>{title}</span>
          {detailLine ? <small>{detailLine}</small> : null}
        </span>
      </button>
    );
  };

  return (
    <div className="details-more-scrim" data-modal="true" onClick={onClose}>
      <div className="details-more playback-options" role="dialog" aria-label="Playback Options" onClick={event => event.stopPropagation()}>
        <h2>Playback Options</h2>
        {!detail ? <LoadingState label="Loading" /> : (
          <>
            {versions.length > 1 ? (
              <>
                <div className="browse-panel-section-heading">VERSION</div>
                {scoped ? null : row(choices.fileId == null, "Auto", "Best match for this device", () => apply({ ...choices, fileId: undefined, audioIndex: undefined, subtitleIndex: undefined }), "v-auto")}
                {rowsFor.map(version => {
                  const selected = scoped ? scopedFileId === version.file_id : choices.fileId === version.file_id;
                  return row(selected, versionShortLabel(version), [version.container?.toUpperCase(), version.bitrate ? `${(version.bitrate / 1_000_000).toFixed(1)} Mbps` : ""].filter(Boolean).join(" · "), () => apply({ ...choices, fileId: version.file_id, audioIndex: undefined, subtitleIndex: undefined, subtitleOff: choices.subtitleOff }), `v-${version.file_id}`);
                })}
              </>
            ) : null}
            <div className="browse-panel-section-heading">AUDIO</div>
            {row(choices.audioIndex == null, "Auto", "Use your playback audio preference", () => apply({ ...choices, audioIndex: undefined }), "a-auto")}
            {audioTracks.map((track, ordinal) => row(
              choices.audioIndex === ordinal,
              audioTitle(track, ordinal),
              audioRowDetail(track, ordinal),
              () => apply({ ...choices, audioIndex: ordinal }),
              `a-${ordinal}`
            ))}
            <div className="browse-panel-section-heading">SUBTITLES</div>
            {row(choices.subtitleIndex == null && !choices.subtitleOff, "Auto", "Use your subtitle preferences", () => apply({ ...choices, subtitleIndex: undefined, subtitleOff: false }), "s-auto")}
            {row(Boolean(choices.subtitleOff), "Off", "Start without subtitles", () => apply({ ...choices, subtitleIndex: undefined, subtitleOff: true }), "s-off")}
            {subtitleTracks.map((track, ordinal) => row(
              choices.subtitleIndex === ordinal,
              subtitleTitle(track, ordinal),
              subtitleRowDetail(track),
              () => apply({ ...choices, subtitleIndex: ordinal, subtitleOff: false }),
              `s-${ordinal}`
            ))}
          </>
        )}
      </div>
    </div>
  );
}
