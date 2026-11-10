import { requestV2 } from "../api/silo";
import type { Session } from "../types";

export type ThemeSelection = { ownerId: string; themes: Array<{ id: string }> };

type Grant = { url: string; delivery?: string };

const TARGET_VOLUME = 0.35;
const FADE_STEPS = 12;
const FADE_STEP_MS = 25;
const RELEASE_GRACE_MS = 2000;
const CAPABILITY_TTL_MS = 60000;

const CANDIDATES: Array<[{ container: string; audio_codec: string }, string]> = [
  [{ container: "mp3", audio_codec: "mp3" }, "audio/mpeg"],
  [{ container: "mp4", audio_codec: "aac" }, 'audio/mp4; codecs="mp4a.40.2"'],
  [{ container: "m4a", audio_codec: "aac" }, 'audio/mp4; codecs="mp4a.40.2"'],
  [{ container: "aac", audio_codec: "aac" }, "audio/aac"],
  [{ container: "flac", audio_codec: "flac" }, "audio/flac"],
  [{ container: "ogg", audio_codec: "vorbis" }, 'audio/ogg; codecs="vorbis"'],
  [{ container: "ogg", audio_codec: "opus" }, 'audio/ogg; codecs="opus"'],
  [{ container: "opus", audio_codec: "opus" }, 'audio/ogg; codecs="opus"'],
  [{ container: "wav", audio_codec: "pcm" }, "audio/wav"]
];

let session: Session | null = null;
let enabled = false;
let loop = false;
let available: boolean | null = null;
let availableAt = 0;
let capabilityRead: Promise<void> | null = null;
let identity = 0;
let page: object | null = null;
let selection: ThemeSelection | null = null;
let releaseTimer: number | undefined;

let audio: HTMLAudioElement | null = null;
let playingOwner = "";
let playingTheme = "";
let converted = false;
let suspended = false;
let generation = 0;
let retry = 0;
let fadeTimer: number | undefined;

function acceptedFormats() {
  const probe = document.createElement("audio");
  return CANDIDATES.filter(([, mime]) => probe.canPlayType(mime) !== "").map(([format]) => format);
}

function clearFade() {
  window.clearInterval(fadeTimer);
  fadeTimer = undefined;
}

function fade(target: HTMLAudioElement, to: number, done?: () => void) {
  clearFade();
  const from = target.volume;
  let step = 0;
  fadeTimer = window.setInterval(() => {
    step += 1;
    target.volume = Math.min(1, Math.max(0, from + (to - from) * step / FADE_STEPS));
    if (step >= FADE_STEPS) { clearFade(); done?.(); }
  }, FADE_STEP_MS);
}

function release(target: HTMLAudioElement) {
  target.pause();
  target.removeAttribute("src");
  target.load();
}

function clearAudio() {
  clearFade();
  if (audio) release(audio);
  audio = null;
}

function stopPlayer(immediate: boolean) {
  suspended = false;
  generation += 1;
  playingOwner = "";
  playingTheme = "";
  const current = audio;
  if (!current) return;
  if (!immediate && !current.paused) {
    audio = null;
    clearFade();
    const from = current.volume;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      current.volume = Math.max(0, from * (1 - step / FADE_STEPS));
      if (step >= FADE_STEPS) { window.clearInterval(timer); release(current); }
    }, FADE_STEP_MS);
  } else clearAudio();
}

async function grant(ownerId: string, themeId: string): Promise<Grant | null> {
  if (!session?.profileId) return null;
  const accepted = acceptedFormats();
  try {
    const result = await requestV2<Grant>(session, `/catalog/items/${encodeURIComponent(ownerId)}/themes/${encodeURIComponent(themeId)}/playback`, {
      method: "POST",
      ...(accepted.length ? { body: JSON.stringify({ accepted_formats: accepted }) } : {})
    });
    if (!result.url) return null;
    const url = /^https?:\/\//.test(result.url) ? result.url : `${session.serverUrl.replace(/\/+$/, "")}${result.url.startsWith("/") ? "" : "/"}${result.url}`;
    return { url, delivery: result.delivery };
  } catch { return null; }
}

function play(target: HTMLAudioElement) {
  void target.play().then(() => { if (!suspended && audio === target) fade(target, TARGET_VOLUME); }).catch(() => undefined);
}

async function load() {
  const started = ++generation;
  const ownerId = playingOwner;
  const themeId = playingTheme;
  const granted = await grant(ownerId, themeId);
  if (!granted || started !== generation) return;
  clearAudio();
  converted = granted.delivery === "converted";
  const created = new Audio();
  created.preload = "auto";
  created.volume = 0;
  created.loop = loop && !converted;
  audio = created;
  created.addEventListener("playing", () => { retry = 0; if (!suspended && audio === created) fade(created, TARGET_VOLUME); });
  const again = () => {
    if (started !== generation || audio !== created) return;
    if (retry >= 1) return;
    retry += 1;
    void load();
  };
  created.addEventListener("ended", () => { if (loop && converted) again(); });
  created.addEventListener("error", again);
  created.src = granted.url;
  if (!suspended) play(created);
}

function select(next: ThemeSelection) {
  const song = next.themes[0];
  if (!song) { stopPlayer(false); return; }
  if (playingOwner === next.ownerId && playingTheme === song.id) {
    if (audio) audio.loop = loop && !converted;
    if (suspended) {
      suspended = false;
      if (audio) { audio.volume = Math.min(audio.volume, TARGET_VOLUME); play(audio); } else void load();
    }
    return;
  }
  stopPlayer(false);
  playingOwner = next.ownerId;
  playingTheme = song.id;
  retry = 0;
  void load();
}

function readCapability() {
  if (capabilityRead || !session) return;
  const asked = identity;
  const current = session;
  capabilityRead = requestV2<{ state?: string; allowed?: boolean }>(current, "/catalog/themes/capabilities")
    .then(result => { if (asked === identity) { available = result.state === "available" && result.allowed !== false; availableAt = Date.now(); } })
    .catch(error => { if (asked === identity && /404/.test(String(error))) { available = false; availableAt = Date.now(); } })
    .finally(() => { capabilityRead = null; apply(); });
}

function apply() {
  if (!enabled || !page) { stopPlayer(false); return; }
  if (Date.now() - availableAt >= CAPABILITY_TTL_MS) readCapability();
  if (available !== true || !selection || !selection.themes.length) { stopPlayer(false); return; }
  select(selection);
}

export function setThemeMusicSession(next: Session | null) {
  const changed = (next?.profileId ?? "") !== (session?.profileId ?? "") || next?.serverUrl !== session?.serverUrl;
  session = next;
  if (!changed) return;
  identity += 1;
  available = null;
  availableAt = 0;
  capabilityRead = null;
  window.clearTimeout(releaseTimer);
  stopPlayer(true);
}

export function setThemeMusicPreferences(nextEnabled: boolean, nextLoop: boolean) {
  if (enabled === nextEnabled && loop === nextLoop) return;
  enabled = nextEnabled;
  loop = nextLoop;
  apply();
}

export function showThemeMusic(owner: object, next: ThemeSelection | null) {
  window.clearTimeout(releaseTimer);
  releaseTimer = undefined;
  page = owner;
  selection = next;
  apply();
}

export function hideThemeMusic(owner: object) {
  if (page !== owner) return;
  page = null;
  selection = null;
  suspended = true;
  const current = audio;
  if (current) fade(current, 0, () => { if (audio === current && suspended) current.pause(); });
  else stopPlayer(true);
  window.clearTimeout(releaseTimer);
  releaseTimer = window.setTimeout(() => { if (!page) stopPlayer(true); }, RELEASE_GRACE_MS);
}

export function interruptThemeMusic() {
  window.clearTimeout(releaseTimer);
  releaseTimer = undefined;
  stopPlayer(true);
}
