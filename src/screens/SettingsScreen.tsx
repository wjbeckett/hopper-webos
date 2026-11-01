import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { serverRegistry } from "../core/serverRegistry";
import { clearDeviceSubtitleAppearance, clearScopedSetting, clearSetting, DEFAULT_SUBTITLE_APPEARANCE, getEffectiveSettings, getSettingsContract, isClientLocal, putDeviceSubtitleAppearance, putScopedSetting, putSetting } from "../api/settings";
import type { SettingDefinition, SettingOption, SettingsContract, SubtitleAppearance } from "../api/settings";
import { getPlaybackConnection, resetLearnedLimit, runSpeedTest } from "../api/playbackConnection";
import type { PlaybackConnection } from "../api/playbackConnection";
import { getDeviceId } from "../platform/device";
import { requestV2 } from "../api/silo";
import { profileLaunchChoices, readProfileLaunchBehavior, writeProfileLaunchBehavior } from "../core/profileLaunch";
import type { ProfileLaunchBehavior } from "../core/profileLaunch";
import { HomeSectionsEditor } from "../components/HomeSectionsEditor";
import { clientIdentity } from "../platform/device";
import { SettingsGlyph } from "../components/icons";
import { LoadingState } from "../components/LoadingState";
import { TvButton } from "../components/TvButton";
import type { Session } from "../types";

type Category = "general" | "playback" | "subtitles" | "server";
type Choice = { label: string; value: unknown; detail?: string };
type PickerRequest = { title: string; choices: Choice[]; current: unknown; returnKey: string; onPick: (value: unknown) => void };

const categories: Array<{ id: Category; label: string; blurb: string; pane: string }> = [
  { id: "general", label: "General", blurb: "App and navigation", pane: "App-level options for this TV." },
  { id: "playback", label: "Playback", blurb: "Quality and episodes", pane: "Streaming quality and episode behavior for this TV." },
  { id: "subtitles", label: "Subtitles", blurb: "Language and appearance", pane: "Language, behavior, and on-screen appearance." },
  { id: "server", label: "Server", blurb: "Connection and version", pane: "The Silo server this TV is connected to." }
];

type KeyGroup = { title: string; keys: string[]; footer?: string };

const keysByCategory: Record<"general" | "subtitles", KeyGroup[]> = {
  general: [
    { title: "Title Pages", keys: ["ui.title_art"], footer: "Use logo artwork as the title when available." },
    { title: "Theme Music", keys: ["ui.theme_music_enabled", "ui.theme_music_loop"], footer: "Play a title's theme music while its page is open, when the server has one. Loop repeats it until you leave the page." },
    { title: "Top Menu", keys: ["nav.show_audiobooks"], footer: "Adds an Audiobooks tab to the top menu when your server has an audiobook library. Hidden by default." }
  ],
  subtitles: [
    { title: "Profile", keys: ["playback.subtitle_language", "playback.subtitle_mode", "playback.show_forced_subtitles"] },
    { title: "Metadata", keys: ["catalog.metadata_language"] }
  ]
};

const languageSetByKey: Record<string, string> = {
  "playback.audio_language": "playback_audio_languages",
  "playback.subtitle_language": "playback_subtitle_languages",
  "catalog.metadata_language": "catalog_metadata_languages"
};

const LOCAL_SETTINGS_STORAGE = "silo-webos-local-settings";

function readLocalSettings(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_STORAGE) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalSettings(values: Record<string, unknown>) {
  localStorage.setItem(LOCAL_SETTINGS_STORAGE, JSON.stringify(values));
}

const USE_PROFILE = "use_profile_setting";
const RESOLUTION_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Auto", value: "auto" }, { label: "4K", value: "2160p" }, { label: "1080p", value: "1080p" },
  { label: "720p", value: "720p" }, { label: "480p", value: "480p" }
];
const profileLayeredKeys = [
  "playback.preferred_quality", "playback.max_bitrate_kbps", "playback.audio_language",
  "playback.buffering_quality_mode", "playback.next_up_prompt_seconds", "playback.intro_skip_mode",
  "playback.auto_play_next", "playback.auto_skip_credits"
];
const BITRATE_CHOICES_KBPS = [200000, 100000, 60000, 40000, 20000, 15000, 10000, 6000, 4000, 2000, 1500];
const SEEK_CHOICES = [5, 10, 15, 30, 45, 60, 90];
const RESUME_REWIND_OPTIONS = [0, 3, 5, 7, 10, 15, 20, 30];
const PASS_OUT_OPTIONS = [0, 2, 3, 4, 5];
const NEXT_UP_OPTIONS = [0, 10, 30, 60, 120];
const DEVICE_DEFAULTS: Record<string, unknown> = {
  "player.dolby_vision_enabled": true,
  "player.dv_profile7_hdr10_fallback": false,
  "player.match_frame_rate": false,
  "player.force_hdr_passthrough": false,
  "player.true_black_bars": false
};

function languageLabel(code: string) {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? name : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function choicesFor(definition: SettingDefinition, contract: SettingsContract, current?: unknown): Choice[] {
  const schema = definition.value_schema;
  if (schema.type === "enum") {
    return (schema.values ?? []).filter(option => !option.deprecated).map((option: SettingOption) => ({ label: option.label, value: option.value }));
  }
  if (schema.type === "language_tag") {
    const set = contract.option_sets[languageSetByKey[definition.key] ?? ""]?.options ?? [];
    return [{ label: "Not set", value: null }, ...set.map(option => ({ label: languageLabel(option.value), value: option.value, detail: option.value }))];
  }
  if (schema.type === "boolean") {
    return [{ label: "On", value: true }, { label: "Off", value: false }];
  }
  if (schema.type === "integer") {
    const min = schema.minimum ?? 0;
    const max = schema.maximum ?? min;
    if (definition.unit === "kbps") {
      const stored = typeof current === "number" && current > 0 && !BITRATE_CHOICES_KBPS.includes(current) ? current : null;
      const values = (stored ? [...BITRATE_CHOICES_KBPS, stored].sort((l, r) => r - l) : BITRATE_CHOICES_KBPS)
        .filter(value => value >= min && value <= max);
      return [{ label: bitrateLabel(null), value: null }, ...values.map(value => ({ label: bitrateLabel(value), value }))];
    }
    const span = max - min;
    const step = span <= 31 ? 1 : span <= 60 ? 5 : 10;
    const unit = definition.unit === "seconds" ? " seconds" : "";
    const list: Choice[] = [];
    for (let value = min; value <= max; value += step) list.push({ label: value === 0 ? "Off" : `${value}${unit}`, value });
    return list;
  }
  return [];
}

function describe(definition: SettingDefinition, value: unknown, contract: SettingsContract) {
  const schema = definition.value_schema;
  if (definition.key === "playback.preferred_quality") return resolutionLabel(value);
  if (definition.unit === "kbps") return bitrateLabel(typeof value === "number" ? value : null);
  if (schema.type === "boolean") return value ? "On" : "Off";
  if (value == null || value === "") return schema.type === "language_tag" ? "Not set" : definition.unit === "kbps" ? "Unlimited" : "Default";
  const match = choicesFor(definition, contract).find(choice => choice.value === value);
  if (match) return match.label;
  if (schema.type === "enum") return (schema.values ?? []).find(option => option.value === value)?.label ?? String(value);
  if (schema.type === "language_tag") return languageLabel(String(value));
  return String(value);
}

function bitrateLabel(kbps: number | null | undefined): string {
  const capped = kbps && kbps > 0 ? kbps : null;
  if (capped == null) return "No limit";
  if (capped % 100 !== 0) return `${capped} kbps`;
  const mbps = capped / 1000;
  const rounded = mbps >= 10 ? Math.round(mbps) : Math.round(mbps * 10) / 10;
  return `${rounded} Mbps`;
}

function rateLabel(kbps: number): string {
  return bitrateLabel(kbps).toLowerCase().replace("mbps", "Mbps");
}

function resolutionLabel(value: unknown): string {
  const normalized = typeof value === "string" ? value.toLowerCase() : "auto";
  if (normalized === "auto" || normalized === "original") return "Auto";
  if (normalized === "4k" || normalized === "2160p") return "4K";
  return normalized;
}

function resolutionDescription(value: unknown): string {
  const normalized = typeof value === "string" ? value.toLowerCase() : "auto";
  if (normalized === "auto" || normalized === "original") return "Plays the original file whenever your device and connection can handle it.";
  return `Plays the original file up to ${resolutionLabel(normalized)}. Larger files are converted.`;
}

function qualityDescription(resolution: unknown, maxBitrateKbps: unknown): string {
  const text = resolutionDescription(resolution);
  const capped = typeof maxBitrateKbps === "number" && maxBitrateKbps > 0;
  return capped ? `${text} Files above this bitrate are converted to fit.` : text;
}

function resumeRewindLabel(seconds: unknown): string {
  const value = typeof seconds === "number" ? seconds : 7;
  return value <= 0 ? "Off" : `${value}s`;
}

function passOutThresholdLabel(count: unknown): string {
  const value = typeof count === "number" ? count : 3;
  return value <= 0 ? "Off" : `${value}`;
}

function nextUpPromptLabel(seconds: unknown): string {
  const value = typeof seconds === "number" ? seconds : 10;
  if (value <= 0) return "At end";
  if (value < 60) return `${value} seconds before end`;
  if (value === 60) return "1 minute before end";
  return `${value / 60} minutes before end`;
}

function ageLabel(iso: string): string {
  const age = Date.now() - new Date(iso).getTime();
  if (age < 60_000) return "just now";
  if (age < 3_600_000) {
    const count = Math.round(age / 60_000);
    return `${count} minute${count === 1 ? "" : "s"} ago`;
  }
  if (age < 86_400_000) {
    const count = Math.round(age / 3_600_000);
    return `${count} hour${count === 1 ? "" : "s"} ago`;
  }
  const count = Math.round(age / 86_400_000);
  return `${count} day${count === 1 ? "" : "s"} ago`;
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function isBackKey(event: KeyboardEvent) {
  return ["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009;
}

function ChoicePicker({ picker, onClose }: { picker: PickerRequest; onClose: () => void }) {
  const { title, choices, current, onPick } = picker;
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      const target = selectedRef.current ?? document.querySelector<HTMLElement>(".settings-picker [data-tv-focusable='true']");
      target?.focus();
      target?.scrollIntoView({ block: "center" });
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="details-more-scrim" data-modal="true" onClick={onClose}>
      <div className="details-more settings-picker" role="dialog" aria-label={title} onClick={event => event.stopPropagation()}>
        <div className="settings-picker-head">
          <span>
            <h2>{title}</h2>
            <small>Choose an option</small>
          </span>
          <span className="settings-picker-hint"><SettingsGlyph name="undo" className="settings-chevron" /> Back to close</span>
        </div>
        <div className="settings-picker-list">
          {choices.map(choice => {
            const selected = choice.value === current || (choice.value == null && current == null);
            return (
              <button
                key={String(choice.value)}
                ref={selected ? selectedRef : undefined}
                data-tv-focusable="true"
                className={`option-row${selected ? " is-selected" : ""}`}
                onClick={() => onPick(choice.value)}
              >
                <span>{choice.label}{choice.detail && !selected ? <small className="settings-picker-detail">{choice.detail}</small> : null}</span>
                {selected ? <SettingsGlyph name="check" className="settings-check" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SettingsScreen({
  session,
  onSignOut,
  onChangeServer,
  onSwitchProfile
}: {
  session: Session;
  onSignOut: () => void;
  onChangeServer: () => void;
  onSwitchProfile: () => void;
}) {
  const [category, setCategory] = useState<Category>("playback");
  const [contract, setContract] = useState<SettingsContract | null>(null);
  const [values, setValues] = useState<Map<string, unknown>>(new Map());
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [privacyQr, setPrivacyQr] = useState("");
  const [subtitleAppearance, setSubtitleAppearance] = useState<SubtitleAppearance>(DEFAULT_SUBTITLE_APPEARANCE);
  const [subtitleDeviceOnly, setSubtitleDeviceOnly] = useState(false);
  const [posterSize, setPosterSize] = useState("standard");
  const [sources, setSources] = useState<Map<string, string>>(new Map());
  const [connection, setConnection] = useState<PlaybackConnection | null>(null);
  const [connectionVisible, setConnectionVisible] = useState(false);
  const [probeUrl, setProbeUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [localSpeed, setLocalSpeed] = useState("");
  const [learnedResetFailed, setLearnedResetFailed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetNotice, setResetNotice] = useState("");
  const [posterSource, setPosterSource] = useState("");
  const [launchBehavior, setLaunchBehavior] = useState<ProfileLaunchBehavior>(readProfileLaunchBehavior);
  const [launchPicker, setLaunchPicker] = useState(false);
  const [homeEditor, setHomeEditor] = useState(false);
  const [profileSubtitleAppearance, setProfileSubtitleAppearance] = useState<SubtitleAppearance>(DEFAULT_SUBTITLE_APPEARANCE);
  const railRef = useRef<HTMLDivElement | null>(null);
  const activeServer = serverRegistry.active();
  const returnFocusRef = useRef<string | null>(null);

  const allKeys = useMemo(() => [...Object.values(keysByCategory).flat().flatMap(group => group.keys), "ui.card_presentation", "playback.subtitle_appearance", "playback.preferred_quality", "playback.max_bitrate_kbps", "playback.audio_language", "playback.buffering_quality_mode", "playback.next_up_prompt_seconds", "playback.intro_skip_mode", "playback.auto_play_next", "playback.auto_skip_credits", "playback.auto_skip_recap", "player.dolby_vision_enabled", "player.dv_profile7_hdr10_fallback", "player.match_frame_rate", "player.resume_rewind_seconds", "player.passout_threshold", "player.video_skip_back_seconds", "player.video_skip_forward_seconds", "player.audiobook_skip_back_seconds", "player.audiobook_skip_forward_seconds"], []);

  useEffect(() => {
    if (!showPrivacyPolicy) return;
    let alive = true;
    QRCode.toDataURL("https://siloserver.org/privacy", { width: 320, margin: 2, errorCorrectionLevel: "M" })
      .then(value => { if (alive) setPrivacyQr(value); })
      .catch(() => { if (alive) setPrivacyQr(""); });
    return () => { alive = false; };
  }, [showPrivacyPolicy]);

  useEffect(() => {
    let alive = true;
    Promise.all([getSettingsContract(session), getEffectiveSettings(session, allKeys)])
      .then(async ([loadedContract, effective]) => {
        if (!alive) return;
        setContract(loadedContract);
        const resolved = new Map(Array.from(effective.entries()).map(([key, entry]) => [key, entry.value]));
        setSources(new Map(Array.from(effective.entries()).map(([key, entry]) => [key, entry.source ?? ""])));
        const local = readLocalSettings();
        for (const definition of loadedContract.definitions) {
          if (!isClientLocal(definition) || !allKeys.includes(definition.key)) continue;
          resolved.set(definition.key, definition.key in local ? local[definition.key] : definition.default_value);
        }
        for (const [key, fallback] of Object.entries(DEVICE_DEFAULTS)) {
          if (!allKeys.includes(key)) continue;
          if (!resolved.has(key) || resolved.get(key) == null) resolved.set(key, key in local && !loadedContract.definitions.some(definition => definition.key === key && !isClientLocal(definition)) ? local[key] : fallback);
        }
        setValues(resolved);
        const appearance = effective.get("playback.subtitle_appearance")?.value;
        const parsedAppearance = typeof appearance === "string" ? (() => { try { return JSON.parse(appearance); } catch { return null; } })() : appearance;
        if (parsedAppearance && typeof parsedAppearance === "object") {
          const normalized = { ...DEFAULT_SUBTITLE_APPEARANCE, ...(parsedAppearance as Partial<SubtitleAppearance>) };
          setSubtitleAppearance(normalized);
          setProfileSubtitleAppearance(normalized);
        }
        const cardValue = effective.get("ui.card_presentation")?.value;
        if (cardValue && typeof cardValue === "object" && "poster_size" in cardValue) {
          const size = String((cardValue as { poster_size: unknown }).poster_size);
          if (["compact", "standard", "large"].includes(size)) setPosterSize(size);
          document.documentElement.dataset.posterSize = size;
        }
        setPosterSource(effective.get("ui.card_presentation")?.source ?? "");
        try {
          const capabilities = await requestV2<{ features?: string[]; bandwidth_probe_url?: string }>(session, "/playback/capabilities", { headers: { "X-Silo-Device-Id": getDeviceId() } });
          const probe = capabilities.bandwidth_probe_url ?? "";
          setProbeUrl(probe);
          if (capabilities.features?.includes("connection_speed_v1")) {
            const link = await getPlaybackConnection(session);
            setConnection(link);
            setConnectionVisible(true);
          }
        } catch {
          setConnectionVisible(false);
        }
        const source = effective.get("playback.subtitle_appearance")?.source ?? "";
        setSubtitleDeviceOnly(source === "profile_device" || source === "device");
      })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load settings."); });
    return () => { alive = false; };
  }, [session.serverUrl, session.profileId, allKeys]);

  useEffect(() => {
    requestAnimationFrame(() => railRef.current?.querySelector<HTMLElement>(`[data-settings-category='${category}']`)?.focus());
    // Initial focus only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!confirmSignOut) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".settings-confirm [data-tv-focusable='true']")?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setConfirmSignOut(false);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-settings-signout]")?.focus());
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmSignOut]);

  const definitions = useMemo(() => new Map((contract?.definitions ?? []).map(definition => [definition.key, definition])), [contract]);

  async function save(definition: SettingDefinition, value: unknown) {
    const previous = values.get(definition.key);
    setValues(current => new Map(current).set(definition.key, value));
    setError("");
    if (isClientLocal(definition)) {
      const local = readLocalSettings();
      if (value == null) delete local[definition.key];
      else local[definition.key] = value;
      writeLocalSettings(local);
      return;
    }
    try {
      if (value == null) await clearSetting(session, definition);
      else await putSetting(session, definition, value);
    } catch (reason) {
      setValues(current => new Map(current).set(definition.key, previous));
      setError(reason instanceof Error ? reason.message : "Could not save this setting.");
    }
  }

  function activate(definition: SettingDefinition) {
    if (definition.value_schema.type === "boolean") {
      void save(definition, !values.get(definition.key));
      return;
    }
    openSettingPicker(definition);
  }

  function refocus(key: string) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-setting-key='${key}']`)?.focus());
  }

  function openSettingPicker(definition: SettingDefinition) {
    const key = definition.key;
    const layered = profileLayeredKeys.includes(key) && (definition.allowed_scopes ?? []).includes("profile_device");
    const lead: Choice[] = layered ? [{ label: "Use profile setting", value: USE_PROFILE }] : [];
    const rest: Choice[] = key === "playback.preferred_quality"
      ? RESOLUTION_OPTIONS.map(option => ({ label: option.label, value: option.value, detail: resolutionDescription(option.value) }))
      : choicesFor(definition, contract!, values.get(key));
    const choices: Choice[] = [...lead, ...rest];
    setPicker({
      title: pickerTitle(key),
      choices,
      current: layered && !isDeviceOverridden(key) ? USE_PROFILE : values.get(key),
      returnKey: key,
      onPick: value => {
        setPicker(null);
        if (layered && value === USE_PROFILE) void useProfileSetting(key);
        else void savePlaybackSetting(definition, value);
        refocus(key);
      }
    });
  }

  function settingValue(key: string): unknown {
    const value = values.get(key);
    return value == null ? DEVICE_DEFAULTS[key] ?? null : value;
  }

  function isDeviceOverridden(key: string): boolean {
    const source = sources.get(key);
    return source === "profile_device" || source === "device";
  }

  function layered(key: string): boolean {
    const definition = definitions.get(key);
    return profileLayeredKeys.includes(key) && Boolean(definition) && (definition!.allowed_scopes ?? []).includes("profile_device");
  }

  function pickerTitle(key: string): string {
    return key === "playback.preferred_quality" ? "Resolution" : key === "playback.max_bitrate_kbps" ? "Maximum Bitrate" : key === "playback.audio_language" ? "Audio Language" : key === "playback.buffering_quality_mode" ? "Lower quality when buffering" : key === "playback.next_up_prompt_seconds" ? "Show Next Up" : key === "playback.intro_skip_mode" ? "Skip Intros" : definitions.get(key)?.label ?? key;
  }

  async function refreshPlaybackValue(key: string) {
    try {
      const effective = await getEffectiveSettings(session, [key]);
      const entry = effective.get(key);
      setValues(current => new Map(current).set(key, entry?.value ?? DEVICE_DEFAULTS[key] ?? null));
      setSources(current => new Map(current).set(key, entry?.source ?? ""));
    } catch { /* keep the optimistic value */ }
  }

  async function savePlaybackSetting(definition: SettingDefinition, value: unknown) {
    const key = definition.key;
    if (layered(key)) {
      const previous = values.get(key);
      const previousSource = sources.get(key);
      setValues(current => new Map(current).set(key, value));
      setSources(current => new Map(current).set(key, value == null ? "" : "profile_device"));
      try {
        if (value == null) await clearScopedSetting(session, key, "profile_device");
        else await putScopedSetting(session, key, "profile_device", value);
      } catch (reason) {
        setValues(current => new Map(current).set(key, previous));
        setSources(current => new Map(current).set(key, previousSource ?? ""));
        setError(reason instanceof Error ? reason.message : "Could not save this setting.");
      }
      return;
    }
    if (!definitions.has(key)) {
      const local = readLocalSettings();
      if (value == null) delete local[key];
      else local[key] = value;
      writeLocalSettings(local);
      setValues(current => new Map(current).set(key, value));
      return;
    }
    await save(definition, value);
  }

  async function useProfileSetting(key: string) {
    try {
      await clearScopedSetting(session, key, "profile_device");
      await refreshPlaybackValue(key);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset this setting.");
    }
  }

  function openLocalPicker(key: string, title: string, choices: Choice[]) {
    setPicker({ title, choices, current: settingValue(key), returnKey: key, onPick: value => { setPicker(null); const definition = definitions.get(key); if (definition) void savePlaybackSetting(definition, value); refocus(key); } });
  }

  async function testSpeed() {
    if (testing) return;
    setTesting(true);
    setTestMessage("");
    setLocalSpeed("");
    try {
      const result = await runSpeedTest(session);
      setLocalSpeed(`${rateLabel(result.kbps)} · measured just now on this connection`);
      if (!result.saved) setTestMessage("Couldn't save the speed test. Try again.");
      try { setConnection(await getPlaybackConnection(session)); } catch { /* keep the last reading */ }
    } catch {
      setTestMessage("Couldn't measure the connection speed. Try again.");
    }
    setTesting(false);
  }

  async function resetLearnedLimitRow() {
    try {
      await resetLearnedLimit(session);
      setLearnedResetFailed(false);
      try { setConnection(await getPlaybackConnection(session)); } catch { /* keep the last reading */ }
    } catch {
      setLearnedResetFailed(true);
    }
  }

  async function resetPlaybackOverrides() {
    const scoped = contract ? contract.definitions.filter(definition => definition.allowed_scopes?.includes("profile_device") && allKeys.includes(definition.key)) : [];
    try {
      for (const definition of scoped) {
        if (isDeviceOverridden(definition.key)) await clearScopedSetting(session, definition.key, "profile_device");
      }
      const local = readLocalSettings();
      for (const key of ["player.force_hdr_passthrough", "player.true_black_bars", "player.resume_rewind_seconds", "player.passout_threshold"]) delete local[key];
      writeLocalSettings(local);
      const effective = await getEffectiveSettings(session, allKeys);
      const resolved = new Map(Array.from(effective.entries()).map(([key, entry]) => [key, entry.value]));
      setSources(new Map(Array.from(effective.entries()).map(([key, entry]) => [key, entry.source ?? ""])));
      const local2 = readLocalSettings();
      if (contract) {
        for (const definition of contract.definitions) {
          if (!isClientLocal(definition) || !allKeys.includes(definition.key)) continue;
          resolved.set(definition.key, definition.key in local2 ? local2[definition.key] : definition.default_value);
        }
      }
      for (const [key, fallback] of Object.entries(DEVICE_DEFAULTS)) {
        if (!allKeys.includes(key)) continue;
        if (!resolved.has(key) || resolved.get(key) == null) resolved.set(key, fallback);
      }
      setValues(resolved);
      setResetNotice("Now using your profile's settings.");
    } catch {
      setResetNotice("Couldn't confirm the change with the server. Try again later.");
    }
  }

  function connectionFooter(): string {
    if (localSpeed) return localSpeed;
    const probe = connection?.probe;
    if (probe) {
      const transport = probe.transport === "wifi" ? "Wi-Fi" : probe.transport === "ethernet" ? "Ethernet" : probe.transport === "cellular" ? "cellular" : "this connection";
      const rate = probe.lower_bound ? `Faster than ${rateLabel(probe.kbps)}` : rateLabel(probe.kbps);
      return `${rate} · measured ${ageLabel(probe.measured_at)} on ${transport}`;
    }
    const sample = connection?.playback_sample;
    if (sample) return `Faster than ${rateLabel(sample.kbps)} · seen during playback ${ageLabel(sample.measured_at)}`;
    return "Not measured yet";
  }

  function valueRow(key: string, label: string, value: string, onClick: () => void) {
    return (
      <button key={key} data-tv-focusable="true" data-setting-key={key} className="option-row settings-row" onClick={onClick}>
        <span>{label}</span><strong>{value}</strong>
      </button>
    );
  }

  function toggleRow(key: string, label: string, checked: boolean, onToggle: () => void) {
    return (
      <button key={key} data-tv-focusable="true" data-setting-key={key} className={`option-row settings-row settings-toggle${checked ? " is-on" : ""}`} onClick={onToggle}>
        <span>{label}</span><strong>{checked ? "On" : "Off"}</strong>
      </button>
    );
  }

  function deviceToggle(key: string, label: string) {
    const checked = Boolean(settingValue(key));
    return toggleRow(key, label, checked, () => { const definition = definitions.get(key); if (definition) void savePlaybackSetting(definition, !checked); else void savePlaybackSetting({ key, label, value_schema: { type: "boolean" } } as SettingDefinition, !checked); });
  }

  function renderPlaybackPane() {
    if (!contract) return null;
    const buffering = definitions.has("playback.buffering_quality_mode");
    const bufferingMode = settingValue("playback.buffering_quality_mode");
    const limit = connection?.learned_limit ?? null;
    const limitShown = limit != null && (!buffering || bufferingMode !== "never");
    const dolbyOn = Boolean(settingValue("player.dolby_vision_enabled"));
    const budgetHidden = (!buffering || bufferingMode === "never") && limit != null;
    const resolutionChoices = RESOLUTION_OPTIONS.map(option => ({ label: option.label, value: option.value, detail: resolutionDescription(option.value) }));
    return (
      <>
        <section className="settings-group">
          <h3>Streaming</h3>
          {definitions.has("playback.preferred_quality") ? valueRow("playback.preferred_quality", "Resolution", resolutionLabel(settingValue("playback.preferred_quality")), () => activate(definitions.get("playback.preferred_quality")!)) : null}
          {definitions.has("playback.max_bitrate_kbps") ? valueRow("playback.max_bitrate_kbps", "Maximum Bitrate", bitrateLabel(typeof settingValue("playback.max_bitrate_kbps") === "number" ? settingValue("playback.max_bitrate_kbps") as number : null), () => activate(definitions.get("playback.max_bitrate_kbps")!)) : null}
          {buffering ? valueRow("playback.buffering_quality_mode", "Lower quality when buffering", describe(definitions.get("playback.buffering_quality_mode")!, settingValue("playback.buffering_quality_mode"), contract), () => activate(definitions.get("playback.buffering_quality_mode")!)) : null}
          {buffering ? <p className="settings-footer">What Silo does on Auto when playback keeps buffering. Silo always asks before lowering a quality you picked.</p> : null}
          {limitShown ? valueRow("playback-learned-limit", `Limited to ${rateLabel(limit!.kbps)} after buffering${shortDate(limit!.observed_at) ? ` on ${shortDate(limit!.observed_at)}` : ""}`, "Reset", () => void resetLearnedLimitRow()) : null}
          {learnedResetFailed ? <p className="settings-footer">Couldn't reset the limit. Try again.</p> : null}
          {definitions.has("playback.audio_language") ? valueRow("playback.audio_language", "Audio Language", describe(definitions.get("playback.audio_language")!, settingValue("playback.audio_language"), contract), () => activate(definitions.get("playback.audio_language")!)) : null}
          {deviceToggle("player.dolby_vision_enabled", "Dolby Vision")}
          {dolbyOn ? deviceToggle("player.dv_profile7_hdr10_fallback", "Profile 7 HDR10 Fallback") : null}
          {deviceToggle("player.match_frame_rate", "Match Content Frame Rate")}
          {deviceToggle("player.force_hdr_passthrough", "Force HDR Passthrough")}
          {deviceToggle("player.true_black_bars", "True Black Bars")}
          <p className="settings-footer">{qualityDescription(settingValue("playback.preferred_quality"), settingValue("playback.max_bitrate_kbps"))} Force HDR Passthrough allows HDR playback when this TV doesn't report support. It does not force the HDMI output into HDR; webOS may still convert the picture to SDR. Enable it only if you've confirmed your TV supports the source format. Unsupported formats may produce a black screen or incorrect colors. True Black Bars stops Silo from drawing the bars around the picture during playback. Try it if they look grey in HDR or Dolby Vision, and turn it off again if they get lighter or show a thin line.</p>
        </section>
        {connectionVisible ? (
          <section className="settings-group">
            <h3>Connection</h3>
            {valueRow("playback-connection-speed", "Connection speed", testing ? "Testing..." : probeUrl ? "Test speed" : "", () => void testSpeed())}
            <p className="settings-footer">{connectionFooter()}</p>
            {testMessage ? <p className="settings-footer">{testMessage}</p> : null}
            {connection?.auto_budget_kbps && !budgetHidden ? <p className="settings-footer">Auto plays videos up to {rateLabel(connection.auto_budget_kbps)} without converting them.</p> : null}
          </section>
        ) : null}
        <section className="settings-group">
          <h3>Episodes</h3>
          {deviceToggle("playback.auto_play_next", "Auto-Play Next Episode")}
          {layered("playback.auto_play_next") && isDeviceOverridden("playback.auto_play_next") ? valueRow("use-profile-auto-play-next", "Use Profile Setting", "", () => void useProfileSetting("playback.auto_play_next")) : null}
          {definitions.has("playback.next_up_prompt_seconds") ? valueRow("playback.next_up_prompt_seconds", "Show Next Up", nextUpPromptLabel(settingValue("playback.next_up_prompt_seconds")), () => activate(definitions.get("playback.next_up_prompt_seconds")!)) : null}
          {definitions.has("playback.intro_skip_mode") ? valueRow("playback.intro_skip_mode", "Skip Intros", describe(definitions.get("playback.intro_skip_mode")!, settingValue("playback.intro_skip_mode"), contract), () => activate(definitions.get("playback.intro_skip_mode")!)) : null}
          {deviceToggle("playback.auto_skip_credits", "Skip Credits")}
          {layered("playback.auto_skip_credits") && isDeviceOverridden("playback.auto_skip_credits") ? valueRow("use-profile-auto-skip-credits", "Use Profile Setting", "", () => void useProfileSetting("playback.auto_skip_credits")) : null}
          {valueRow("player.resume_rewind_seconds", "Rewind on Resume", resumeRewindLabel(settingValue("player.resume_rewind_seconds")), () => openLocalPicker("player.resume_rewind_seconds", "Rewind on Resume", RESUME_REWIND_OPTIONS.map(seconds => ({ label: resumeRewindLabel(seconds), value: seconds }))))}
          {valueRow("player.passout_threshold", "Still Watching Prompt", passOutThresholdLabel(settingValue("player.passout_threshold")), () => openLocalPicker("player.passout_threshold", "Still Watching Prompt", PASS_OUT_OPTIONS.map(count => ({ label: passOutThresholdLabel(count), value: count }))))}
          <p className="settings-footer">Rewind on Resume skips back when you return to a partly watched title. Still Watching Prompt sets how many episodes play in a row before Silo asks whether you're still watching.</p>
        </section>
        <section className="settings-group">
          <h3>Spoilers</h3>
          {definitions.has("catalog.hide_unwatched_episode_images") ? toggleRow("catalog.hide_unwatched_episode_images", "Blur unwatched episode images", Boolean(values.get("catalog.hide_unwatched_episode_images")), () => activate(definitions.get("catalog.hide_unwatched_episode_images")!)) : null}
          {definitions.has("catalog.hide_unwatched_episode_overviews") ? toggleRow("catalog.hide_unwatched_episode_overviews", "Hide unwatched episode descriptions", Boolean(values.get("catalog.hide_unwatched_episode_overviews")), () => activate(definitions.get("catalog.hide_unwatched_episode_overviews")!)) : null}
          <p className="settings-footer">Applies to episodes you have not started, on every device that uses this profile.</p>
        </section>
        {definitions.has("player.video_skip_back_seconds") ? (
          <section className="settings-group">
            <h3>Video</h3>
            {valueRow("player.video_skip_back_seconds", "Skip Back", `${settingValue("player.video_skip_back_seconds")}s`, () => openSettingPicker(definitions.get("player.video_skip_back_seconds")!))}
            {valueRow("player.video_skip_forward_seconds", "Skip Forward", `${settingValue("player.video_skip_forward_seconds")}s`, () => openSettingPicker(definitions.get("player.video_skip_forward_seconds")!))}
            <p className="settings-footer">Used by left and right presses on the remote and the on-screen skip buttons. Applies to every device signed in to this profile.</p>
          </section>
        ) : null}
        {definitions.has("player.audiobook_skip_back_seconds") ? (
          <section className="settings-group">
            <h3>Audiobooks</h3>
            {valueRow("player.audiobook_skip_back_seconds", "Skip Back", `${settingValue("player.audiobook_skip_back_seconds")}s`, () => openSettingPicker(definitions.get("player.audiobook_skip_back_seconds")!))}
            {valueRow("player.audiobook_skip_forward_seconds", "Skip Forward", `${settingValue("player.audiobook_skip_forward_seconds")}s`, () => openSettingPicker(definitions.get("player.audiobook_skip_forward_seconds")!))}
            <p className="settings-footer">Used by the audiobook player's skip buttons. Applies to every device signed in to this profile.</p>
          </section>
        ) : null}
        <section className="settings-group">
          <h3>Reset</h3>
          <button data-tv-focusable="true" data-setting-key="reset-playback" className="option-row settings-row settings-destructive" onClick={() => setConfirmReset(true)}><span>Use Profile Settings</span></button>
          <p className="settings-footer">Goes back to your profile's playback settings on this device. Settings that only apply to this device go back to their defaults.</p>
          {resetNotice ? <p className="settings-footer">{resetNotice}</p> : null}
        </section>
      </>
    );
  }

  const renderGroups = (groups: KeyGroup[]) => groups.map(group => {
    const rows = group.keys.map(key => definitions.get(key)).filter((definition): definition is SettingDefinition => Boolean(definition)).filter(definition => definition.value_schema.type !== "object");
    if (!rows.length) return null;
    return (
      <section className="settings-group" key={group.title}>
        <h3>{group.title}</h3>
        {rows.map(definition => (
          <button
            key={definition.key}
            data-tv-focusable="true"
            data-setting-key={definition.key}
            className={`option-row settings-row${definition.value_schema.type === "boolean" ? " settings-toggle" : ""}${definition.value_schema.type === "boolean" && values.get(definition.key) ? " is-on" : ""}`}
            onClick={() => activate(definition)}
          >
            <span>{definition.label}</span>
            <strong>{describe(definition, values.get(definition.key), contract!)}</strong>
          </button>
        ))}
        {group.footer ? <p className="settings-footer">{group.footer}</p> : null}
      </section>
    );
  });

  const appearanceDefinition = definitions.get("playback.subtitle_appearance");
  const appearanceOptions: Record<string, Choice[]> = {
    posterSize: [{ label: "Compact", value: "compact" }, { label: "Standard", value: "standard" }, { label: "Large", value: "large" }],
    fontSize: ["small", "medium", "large", "xlarge", "xxlarge"].map(value => ({ label: value, value })),
    fontFamily: ["sans-serif", "serif", "monospace"].map(value => ({ label: value, value })),
    fontColor: ["#ffffff", "#ffff00", "#00ffff", "#00ff00"].map(value => ({ label: value, value, detail: value })),
    textOpacity: [25, 50, 75, 100].map(value => ({ label: `${value}%`, value })),
    backgroundColor: ["#000000", "#202020", "#000033", "#ffffff"].map(value => ({ label: value, value, detail: value })),
    backgroundStyle: ["box", "shadow", "outline", "none"].map(value => ({ label: value, value })),
    backgroundOpacity: [0, 25, 50, 75, 100].map(value => ({ label: `${value}%`, value })),
    textOutline: [{ label: "On", value: true }, { label: "Off", value: false }],
    textOutlineColor: ["#000000", "#ffffff", "#ffff00"].map(value => ({ label: value, value })),
    position: [{ label: "Bottom", value: "bottom" }, { label: "Lower third", value: "lower-third" }, { label: "Top", value: "top" }]
  };
  function changeAppearance(key: keyof SubtitleAppearance) {
    if (!appearanceDefinition) return;
    const title = key === "fontSize" ? "Font size" : key === "fontFamily" ? "Font family" : key === "fontColor" ? "Font color" : key === "textOpacity" ? "Text opacity" : key === "backgroundColor" ? "Background color" : key === "backgroundStyle" ? "Background style" : key === "backgroundOpacity" ? "Background opacity" : key === "textOutline" ? "Text outline" : key === "textOutlineColor" ? "Outline color" : "Position";
    setPicker({ title, choices: appearanceOptions[key], current: subtitleAppearance[key], returnKey: `subtitle-appearance-${key}`, onPick: value => { setPicker(null); void chooseAppearance(key, value); } });
  }
  async function writePoster(next: string, scope: "profile_device" | "profile_client") {
    const definition = definitions.get("ui.card_presentation");
    if (!definition) return;
    const previousSize = posterSize;
    const previousSource = posterSource;
    setPosterSize(next);
    setPosterSource(scope);
    document.documentElement.dataset.posterSize = next;
    try { await putScopedSetting(session, definition.key, scope, { poster_size: next, caption: "title_metadata" }); }
    catch (reason) {
      setPosterSize(previousSize);
      setPosterSource(previousSource);
      document.documentElement.dataset.posterSize = previousSize;
      setError(reason instanceof Error ? reason.message : "Could not save poster size.");
    }
  }

  async function setPosterDeviceOnly(on: boolean) {
    const definition = definitions.get("ui.card_presentation");
    if (!definition) return;
    try {
      if (on) await putScopedSetting(session, definition.key, "profile_device", { poster_size: posterSize, caption: "title_metadata" });
      else await clearScopedSetting(session, definition.key, "profile_device");
      const effective = await getEffectiveSettings(session, ["ui.card_presentation"]);
      const entry = effective.get("ui.card_presentation");
      const size = entry?.value && typeof entry.value === "object" ? String((entry.value as { poster_size?: unknown }).poster_size) : posterSize;
      if (["compact", "standard", "large"].includes(size)) { setPosterSize(size); document.documentElement.dataset.posterSize = size; }
      setPosterSource(entry?.source ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change poster size scope.");
    }
  }

  async function useProfilePosterDefault() {
    const definition = definitions.get("ui.card_presentation");
    if (!definition) return;
    try {
      await clearScopedSetting(session, definition.key, "profile_client");
      const effective = await getEffectiveSettings(session, ["ui.card_presentation"]);
      const entry = effective.get("ui.card_presentation");
      const size = entry?.value && typeof entry.value === "object" ? String((entry.value as { poster_size?: unknown }).poster_size) : "standard";
      if (["compact", "standard", "large"].includes(size)) { setPosterSize(size); document.documentElement.dataset.posterSize = size; }
      setPosterSource(entry?.source ?? "");
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-setting-key='poster-size']")?.focus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset poster size.");
    }
  }

  function renderCardPresentation() {
    const definition = definitions.get("ui.card_presentation");
    return (
      <section className="settings-group">
        <h3>Cards & Posters</h3>
        {!definition ? <p className="settings-footer">Update your Silo server to customize media cards.</p> : (
          <>
            <button data-tv-focusable="true" data-setting-key="poster-size" className="option-row settings-row" onClick={() => setPicker({ title: "Poster Size", choices: appearanceOptions.posterSize, current: posterSize, returnKey: "poster-size", onPick: value => { setPicker(null); void chooseAppearance("posterSize", value); } })}><span>Poster Size</span><strong>{posterSize[0].toUpperCase() + posterSize.slice(1)}</strong></button>
            <button data-tv-focusable="true" data-setting-key="poster-device-only" className={`option-row settings-row settings-toggle${posterSource === "profile_device" ? " is-on" : ""}`} onClick={() => void setPosterDeviceOnly(posterSource !== "profile_device")}><span>Only This Device</span><strong>{posterSource === "profile_device" ? "On" : "Off"}</strong></button>
            {posterSource === "profile_client" ? <button data-tv-focusable="true" className="option-row settings-row" onClick={() => void useProfilePosterDefault()}><span>Use Profile Default</span></button> : null}
            <p className="settings-footer">Poster size syncs with other TVs on this profile unless Only This Device is on.</p>
          </>
        )}
      </section>
    );
  }

  function renderProfileLaunch() {
    const active = profileLaunchChoices.find(choice => choice.value === launchBehavior) ?? profileLaunchChoices[0];
    return (
      <section className="settings-group">
        <h3>Profile at Launch</h3>
        <button data-tv-focusable="true" data-setting-key="profile-launch" className="option-row settings-row" onClick={() => setLaunchPicker(true)}><span>Profile Selection</span><strong>{active.label}</strong></button>
        <p className="settings-footer">{active.detail}</p>
      </section>
    );
  }

  function renderHomeSections() {
    return (
      <section className="settings-group">
        <h3>Home Sections</h3>
        <button data-tv-focusable="true" data-setting-key="home-sections" className="option-row settings-row" onClick={() => setHomeEditor(true)}><span>Home Sections</span></button>
        <p className="settings-footer">Choose which Home rows are visible and edit the order in which they appear on this TV.</p>
      </section>
    );
  }

  async function chooseAppearance(field: string, value: unknown) {
    if (field === "posterSize") {
      await writePoster(String(value), posterSource === "profile_device" ? "profile_device" : "profile_client");
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-setting-key='poster-size']")?.focus());
      return;
    }
    const key = field as keyof SubtitleAppearance;
    const next = { ...subtitleAppearance, [key]: value };
    setSubtitleAppearance(next);
    try {
      if (subtitleDeviceOnly) await putDeviceSubtitleAppearance(session, next);
      else if (appearanceDefinition) await putSetting(session, appearanceDefinition, next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save subtitle appearance.");
    }
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-setting-key='subtitle-appearance-${key}']`)?.focus());
  }
  function renderSubtitleAppearance() {
    if (!appearanceDefinition) return null;
    const fields: Array<[keyof SubtitleAppearance, string]> = [["fontSize", "Font size"], ["fontFamily", "Font family"], ["fontColor", "Font color"], ["textOpacity", "Text opacity"], ["backgroundStyle", "Background style"], ["backgroundColor", "Background color"], ["backgroundOpacity", "Background opacity"], ["textOutline", "Text outline"], ["textOutlineColor", "Outline color"], ["position", "Position"]];
    const values = (appearance: SubtitleAppearance) => fields.map(([key, label]) => <button key={key} data-tv-focusable="true" data-setting-key={`subtitle-appearance-${key}`} className="option-row settings-row" onClick={() => changeAppearance(key)}><span>{label}</span><strong>{String(appearance[key])}</strong></button>);
    return <section className="settings-group"><h3>Appearance</h3>
      <button data-tv-focusable="true" className="option-row settings-row" onClick={async () => {
        const next = !subtitleDeviceOnly; setSubtitleDeviceOnly(next);
        try {
          if (next) await putDeviceSubtitleAppearance(session, subtitleAppearance);
          else {
            await clearDeviceSubtitleAppearance(session);
            const effective = await getEffectiveSettings(session, ["playback.subtitle_appearance"]);
            const value = effective.get("playback.subtitle_appearance")?.value;
            const restored = value && typeof value === "object" ? { ...DEFAULT_SUBTITLE_APPEARANCE, ...(value as Partial<SubtitleAppearance>) } : DEFAULT_SUBTITLE_APPEARANCE;
            setSubtitleAppearance(restored);
            setProfileSubtitleAppearance(restored);
          }
        } catch (reason) { setSubtitleDeviceOnly(!next); setError(reason instanceof Error ? reason.message : "Could not change subtitle scope."); }
      }}><span>Only on this device</span><strong>{subtitleDeviceOnly ? "On" : "Off"}</strong></button>
      {values(subtitleAppearance)}
      <button data-tv-focusable="true" className="option-row settings-row" onClick={async () => {
        setSubtitleAppearance(DEFAULT_SUBTITLE_APPEARANCE);
        try {
          if (subtitleDeviceOnly) await putDeviceSubtitleAppearance(session, DEFAULT_SUBTITLE_APPEARANCE);
          else if (appearanceDefinition) await putSetting(session, appearanceDefinition, DEFAULT_SUBTITLE_APPEARANCE);
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reset subtitle appearance."); }
      }}><span>Reset appearance</span></button>
      <div className="subtitle-settings-preview" style={{ color: subtitleAppearance.fontColor, opacity: subtitleAppearance.textOpacity / 100, fontFamily: subtitleAppearance.fontFamily, fontSize: subtitleAppearance.fontSize === "small" ? "1rem" : subtitleAppearance.fontSize === "medium" ? "1.2rem" : subtitleAppearance.fontSize === "xlarge" ? "1.8rem" : subtitleAppearance.fontSize === "xxlarge" ? "2rem" : "1.5rem", background: subtitleAppearance.backgroundStyle === "none" ? "transparent" : subtitleAppearance.backgroundColor, textShadow: subtitleAppearance.backgroundStyle === "shadow" ? "0 2px 5px #000" : undefined, WebkitTextStroke: subtitleAppearance.textOutline ? `1px ${subtitleAppearance.textOutlineColor}` : undefined }}>A live subtitle preview</div>
    </section>;
  }

  let pane;
  if (category === "server") {
    pane = (
      <>
        <section className="settings-group">
          <h3>Active Server</h3>
          <div className="option-row settings-static"><span>Server</span><strong>{activeServer?.name || "Not configured"}</strong></div>
          {session.serverUrl && activeServer?.name !== session.serverUrl ? <div className="option-row settings-static"><span>Address</span><strong>{session.serverUrl}</strong></div> : null}
          <button data-tv-focusable="true" className="option-row settings-row" onClick={onChangeServer}><span>Manage Servers</span></button>
        </section>
        <section className="settings-group">
          <h3>About</h3>
          <div className="option-row settings-static"><span>App Version</span><strong>{clientIdentity.version}</strong></div>
          <button data-tv-focusable="true" data-setting-key="privacy-policy" className="option-row settings-row" onClick={() => setShowPrivacyPolicy(true)}><span>Privacy Policy</span></button>
        </section>
      </>
    );
  } else if (!contract) {
    pane = error ? <p className="settings-error">{error}</p> : <LoadingState />;
  } else if (category === "subtitles") {
    pane = <>{renderGroups(keysByCategory.subtitles)}{renderSubtitleAppearance()}</>;
  } else if (category === "general") {
    pane = <>{renderProfileLaunch()}{renderHomeSections()}{renderCardPresentation()}{renderGroups(keysByCategory.general)}</>;
  } else {
    pane = renderPlaybackPane();
  }

  function closePicker() {
    const key = picker?.returnKey ?? null;
    setPicker(null);
    if (key) refocus(key);
  }

  return (
    <main className="content-screen settings-screen settings-split">
      <nav className="settings-rail" ref={railRef} aria-label="Settings">
        <h1>Settings</h1>
        <button data-tv-focusable="true" className="settings-account" onClick={onSwitchProfile}>
          <span className="settings-avatar" aria-hidden="true">{(session.username || "S").slice(0, 1).toUpperCase()}</span>
          <span className="settings-account-text">
            <span className="settings-account-name">{session.username}</span>
            <small>Switch profile</small>
          </span>
          <SettingsGlyph name="chevron" className="settings-chevron" />
        </button>
        {categories.map(entry => (
          <button
            key={entry.id}
            data-tv-focusable="true"
            data-settings-category={entry.id}
            aria-current={category === entry.id ? "true" : undefined}
            className="settings-category"
            onFocus={() => setCategory(entry.id)}
            onClick={() => document.querySelector<HTMLElement>(".settings-pane [data-tv-focusable='true']")?.focus()}
          >
            <SettingsGlyph name={entry.id} />
            <span className="settings-category-text">
              <span>{entry.label}</span>
              <small>{entry.blurb}</small>
            </span>
          </button>
        ))}
        <button data-tv-focusable="true" data-settings-signout className="settings-category settings-signout" onClick={() => setConfirmSignOut(true)}>
          <SettingsGlyph name="signout" />
          <span className="settings-category-text"><span>Sign Out</span></span>
        </button>
        <small className="settings-version">Silo {clientIdentity.version}</small>
      </nav>

      <section className="settings-pane" aria-label={categories.find(entry => entry.id === category)?.label}>
        <header className="settings-pane-header">
          <span className="settings-pane-tile"><SettingsGlyph name={category} /></span>
          <span>
            <h2>{categories.find(entry => entry.id === category)?.label}</h2>
            <p>{categories.find(entry => entry.id === category)?.pane}</p>
          </span>
        </header>
        {error && contract ? <p className="settings-error">{error}</p> : null}
        {pane}
      </section>

      {showPrivacyPolicy ? (
        <div className="details-more-scrim" data-modal="true" onClick={() => setShowPrivacyPolicy(false)} onKeyDown={event => {
          if (["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009) {
            event.preventDefault(); event.stopPropagation(); setShowPrivacyPolicy(false); refocus("privacy-policy");
          }
        }}>
          <div className="details-more settings-privacy-dialog" role="dialog" aria-label="Privacy Policy" onClick={event => event.stopPropagation()}>
            <h2>Privacy Policy</h2>
            <p>Scan this code with your phone, or type the address below, to read the full policy.</p>
            {privacyQr ? <img className="settings-privacy-qr" src={privacyQr} alt="QR code for the Silo privacy policy" /> : <LoadingState />}
            <strong>https://siloserver.org/privacy</strong>
            <TvButton autoFocus onClick={() => { setShowPrivacyPolicy(false); refocus("privacy-policy"); }}>Done</TvButton>
          </div>
        </div>
      ) : null}

      {picker ? <ChoicePicker picker={picker} onClose={closePicker} /> : null}

      {launchPicker ? (
        <ChoicePicker
          picker={{
            title: "Profile Selection",
            choices: profileLaunchChoices.map(choice => ({ label: choice.label, value: choice.value, detail: choice.detail })),
            current: launchBehavior,
            returnKey: "profile-launch",
            onPick: value => {
              const next = value as ProfileLaunchBehavior;
              writeProfileLaunchBehavior(next);
              setLaunchBehavior(next);
              setLaunchPicker(false);
              refocus("profile-launch");
            }
          }}
          onClose={() => { setLaunchPicker(false); refocus("profile-launch"); }}
        />
      ) : null}

      {homeEditor ? (
        <HomeSectionsEditor
          session={session}
          onClose={() => {
            setHomeEditor(false);
            requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-setting-key='home-sections']")?.focus());
          }}
        />
      ) : null}

      {confirmReset ? (
        <div className="details-more-scrim" data-modal="true" onClick={() => setConfirmReset(false)}>
          <div className="details-more settings-confirm" role="alertdialog" aria-label="Use profile settings" onClick={event => event.stopPropagation()}>
            <h2>Use your profile's settings on this device?</h2>
            <p>This removes the settings changed on this device. Settings that only apply to this device go back to their defaults.</p>
            <div className="settings-confirm-actions">
              <TvButton className="secondary" onClick={() => { setConfirmReset(false); refocus("reset-playback"); }}>Cancel</TvButton>
              <TvButton className="destructive" autoFocus onClick={() => { setConfirmReset(false); void resetPlaybackOverrides(); refocus("reset-playback"); }}>Use Profile Settings</TvButton>
            </div>
          </div>
        </div>
      ) : null}

      {confirmSignOut ? (
        <div className="details-more-scrim" data-modal="true" onClick={() => setConfirmSignOut(false)}>
          <div className="details-more settings-confirm" role="alertdialog" aria-label="Sign out" onClick={event => event.stopPropagation()}>
            <h2>Sign out?</h2>
            <p>This TV goes back to the sign-in screen. Your profiles and watch history stay on the server.</p>
            <div className="settings-confirm-actions">
              <TvButton className="secondary" onClick={() => setConfirmSignOut(false)}>Cancel</TvButton>
              <TvButton className="destructive" autoFocus onClick={onSignOut}>Sign out</TvButton>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
