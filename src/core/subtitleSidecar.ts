import { playbackUrl, type PlaybackPlan } from "../api/playback";
import type { Session } from "../types";

function srtToVtt(text: string) {
  const body = text.replace(/\r+/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return body.trimStart().startsWith("WEBVTT") ? body : `WEBVTT\n\n${body}`;
}

/** Minimal WebVTT/SRT cue parser: start, end, text. */
export function parseSubtitleCues(input: string): Array<{ start: number; end: number; text: string }> {
  const seconds = (stamp: string) => {
    const parts = stamp.trim().replace(",", ".").split(":").map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : 0;
  };
  const cues: Array<{ start: number; end: number; text: string }> = [];
  const blocks = input.replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n/, "").split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n").filter(line => line.trim() !== "");
    const stampLine = lines.find(line => line.includes("-->"));
    if (!stampLine) continue;
    const [from, to] = stampLine.split("-->").map(side => side.trim().split(" ")[0]);
    const text = lines.slice(lines.indexOf(stampLine) + 1).join("\n").replace(/<[^>]+>/g, "");
    if (text) cues.push({ start: seconds(from), end: seconds(to), text });
  }
  return cues;
}

export function sidecarSubtitleArtifact(plan: PlaybackPlan) {
  return plan.selected_tracks.subtitle && plan.subtitle.artifact?.url ? plan.subtitle.artifact : null;
}

export async function attachSidecarSubtitle(video: HTMLVideoElement, plan: PlaybackPlan, session: Session, headers: Record<string, string>, previous: TextTrack | null): Promise<TextTrack | null> {
  if (previous) previous.mode = "disabled";
  const artifact = sidecarSubtitleArtifact(plan);
  if (!artifact) return null;
  const response = await fetch(playbackUrl(session, artifact.url), { headers });
  if (!response.ok) return null;
  let text = await response.text();
  if (!/webvtt/i.test(artifact.format ?? "") && (artifact.format ?? "").toLowerCase() !== "vtt" && !text.trimStart().startsWith("WEBVTT")) {
    text = srtToVtt(text);
  }
  const origin = artifact.timing_origin_seconds ?? 0;
  const track = video.addTextTrack("subtitles", "Sidecar", "");
  track.mode = "showing";
  for (const cue of parseSubtitleCues(text)) {
    track.addCue(new VTTCue(Math.max(0, cue.start + origin), Math.max(0, cue.end + origin), cue.text));
  }
  return track;
}
