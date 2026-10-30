import { useEffect, useMemo, useRef, useState } from "react";
import { clearDeviceSubtitleAppearance, clearSetting, DEFAULT_SUBTITLE_APPEARANCE, getEffectiveSettings, getSettingsContract, putDeviceSubtitleAppearance, putSetting } from "../api/settings";
import type { SettingDefinition, SettingOption, SettingsContract, SubtitleAppearance } from "../api/settings";
import { clientIdentity } from "../platform/device";
import { LoadingState } from "../components/LoadingState";
import { TvButton } from "../components/TvButton";
import type { Session } from "../types";

type Category = "general" | "playback" | "subtitles" | "server";
type Choice = { label: string; value: unknown; detail?: string };

const categories: Array<{ id: Category; label: string; blurb: string }> = [
  { id: "general", label: "General", blurb: "App and navigation" },
  { id: "playback", label: "Playback", blurb: "Quality and episodes" },
  { id: "subtitles", label: "Subtitles", blurb: "Language and behavior" },
  { id: "server", label: "Server", blurb: "Connection and account" }
];

const keysByCategory: Record<Exclude<Category, "server">, Array<{ title: string; keys: string[] }>> = {
  general: [
    { title: "Cards & Posters", keys: ["ui.card_presentation"] },
    { title: "Theme Music", keys: ["ui.theme_music_enabled", "ui.theme_music_loop"] },
    { title: "Subtitle Appearance", keys: ["playback.subtitle_appearance"] }
  ],
  playback: [
    { title: "Streaming", keys: ["playback.preferred_quality", "playback.max_bitrate_kbps", "playback.audio_language", "playback.buffering_quality_mode"] },
    { title: "Episodes", keys: ["playback.auto_play_next", "playback.next_up_prompt_seconds", "playback.intro_skip_mode", "playback.auto_skip_credits", "playback.auto_skip_recap"] },
    { title: "Seeking", keys: ["player.video_skip_back_seconds", "player.video_skip_forward_seconds"] }
  ],
  subtitles: [
    { title: "Profile", keys: ["playback.subtitle_language", "playback.subtitle_mode", "playback.show_forced_subtitles"] }
  ]
};

const languageSetByKey: Record<string, string> = {
  "playback.audio_language": "playback_audio_languages",
  "playback.subtitle_language": "playback_subtitle_languages"
};

const bitratePresets = [2000, 4000, 8000, 12000, 20000, 40000, 80000];

function languageLabel(code: string) {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? name : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function choicesFor(definition: SettingDefinition, contract: SettingsContract): Choice[] {
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
      return [{ label: "Unlimited", value: null }, ...bitratePresets.filter(value => value >= min && value <= max).map(value => ({ label: `${value / 1000} Mbps`, value }))];
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
  if (schema.type === "boolean") return value ? "On" : "Off";
  if (value == null || value === "") return schema.type === "language_tag" ? "Not set" : definition.unit === "kbps" ? "Unlimited" : "Default";
  const match = choicesFor(definition, contract).find(choice => choice.value === value);
  if (match) return match.label;
  if (schema.type === "enum") return (schema.values ?? []).find(option => option.value === value)?.label ?? String(value);
  if (schema.type === "language_tag") return languageLabel(String(value));
  return String(value);
}

function isBackKey(event: KeyboardEvent) {
  return ["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009;
}

function ChoicePicker({ title, choices, current, onPick, onClose }: { title: string; choices: Choice[]; current: unknown; onPick: (value: unknown) => void; onClose: () => void }) {
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
        <h2>{title}</h2>
        <div className="settings-picker-list">
          {choices.map(choice => {
            const selected = choice.value === current || (choice.value == null && current == null);
            return (
              <button
                key={String(choice.value)}
                ref={selected ? selectedRef : undefined}
                data-tv-focusable="true"
                className="option-row"
                onClick={() => onPick(choice.value)}
              >
                <span>{choice.label}</span>
                <small>{selected ? "Selected" : choice.detail ?? ""}</small>
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
  const [picker, setPicker] = useState<SettingDefinition | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [subtitleAppearance, setSubtitleAppearance] = useState<SubtitleAppearance>(DEFAULT_SUBTITLE_APPEARANCE);
  const [subtitleDeviceOnly, setSubtitleDeviceOnly] = useState(false);
  const [posterSize, setPosterSize] = useState("standard");
  const [profileSubtitleAppearance, setProfileSubtitleAppearance] = useState<SubtitleAppearance>(DEFAULT_SUBTITLE_APPEARANCE);
  const railRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<string | null>(null);

  const allKeys = useMemo(() => Object.values(keysByCategory).flat().flatMap(group => group.keys), []);

  useEffect(() => {
    let alive = true;
    Promise.all([getSettingsContract(session), getEffectiveSettings(session, allKeys)])
      .then(([loadedContract, effective]) => {
        if (!alive) return;
        setContract(loadedContract);
        setValues(new Map(Array.from(effective.entries()).map(([key, entry]) => [key, entry.value])));
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
    returnFocusRef.current = definition.key;
    setPicker(definition);
  }

  function closePicker() {
    const key = returnFocusRef.current;
    setPicker(null);
    requestAnimationFrame(() => {
      const settingKey = key === "appearance:posterSize" ? "poster-size" : key?.startsWith("appearance:") ? `subtitle-appearance-${key.slice("appearance:".length)}` : key;
      document.querySelector<HTMLElement>(`[data-setting-key='${settingKey}']`)?.focus();
    });
  }

  function pick(definition: SettingDefinition, value: unknown) {
    void save(definition, value);
    closePicker();
  }

  const renderGroups = (groups: Array<{ title: string; keys: string[] }>) => groups.map(group => {
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
            className="option-row settings-row"
            onClick={() => activate(definition)}
          >
            <span>
              {definition.label}
              {definition.description ? <small className="settings-row-hint">{definition.description}</small> : null}
            </span>
            <strong>{describe(definition, values.get(definition.key), contract!)}</strong>
          </button>
        ))}
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
    returnFocusRef.current = `subtitle-appearance-${key}`;
    setPicker({ ...appearanceDefinition, key: `appearance:${key}`, label: key === "fontSize" ? "Font size" : key === "fontFamily" ? "Font family" : key === "fontColor" ? "Font color" : key === "textOpacity" ? "Text opacity" : key === "backgroundColor" ? "Background color" : key === "backgroundStyle" ? "Background style" : key === "backgroundOpacity" ? "Background opacity" : key === "textOutline" ? "Text outline" : key === "textOutlineColor" ? "Outline color" : "Position", value_schema: { type: "enum", values: appearanceOptions[key].map(option => ({ label: option.label, value: option.value as string | number | boolean })) } });
  }
  function renderCardPresentation() {
    const definition = definitions.get("ui.card_presentation");
    if (!definition) return null;
    return <section className="settings-group"><h3>Cards & Posters</h3><button data-tv-focusable="true" data-setting-key="poster-size" className="option-row settings-row" onClick={() => { returnFocusRef.current = "poster-size"; setPicker({ ...definition, key: "appearance:posterSize", label: "Poster size" }); }}><span>Poster size</span><strong>{posterSize[0].toUpperCase() + posterSize.slice(1)}</strong></button><p className="settings-row-hint">Changes poster size across browse and home rails.</p></section>;
  }

  async function chooseAppearance(value: unknown) {
    if (!picker?.key.startsWith("appearance:")) return;
    const field = picker.key.slice("appearance:".length);
    setPicker(null);
    if (field === "posterSize") {
      const definition = definitions.get("ui.card_presentation");
      if (!definition) return;
      const next = String(value);
      setPosterSize(next);
      document.documentElement.dataset.posterSize = next;
      try { await putSetting(session, definition, { poster_size: next, caption: "title_metadata" }); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save poster size."); }
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
          <h3>Active server</h3>
          <div className="option-row settings-static"><span>Address</span><strong>{session.serverUrl}</strong></div>
          <div className="option-row settings-static"><span>Signed in as</span><strong>{session.username}</strong></div>
          <button data-tv-focusable="true" className="option-row settings-row" onClick={onChangeServer}><span>Switch or add server</span></button>
        </section>
        <section className="settings-group">
          <h3>About</h3>
          <div className="option-row settings-static"><span>App</span><strong>{clientIdentity.client} {clientIdentity.version}</strong></div>
        </section>
      </>
    );
  } else if (!contract) {
    pane = error ? <p className="settings-error">{error}</p> : <LoadingState />;
  } else if (category === "subtitles") {
    pane = <>{renderGroups(keysByCategory.subtitles)}{renderSubtitleAppearance()}</>;
  } else if (category === "general") {
    pane = <>{renderGroups(keysByCategory.general)}{renderSubtitleAppearance()}</>;
  } else {
    pane = renderGroups(keysByCategory.playback);
  }

  const current = picker ? values.get(picker.key) : undefined;

  return (
    <main className="content-screen settings-screen settings-split">
      <nav className="settings-rail" ref={railRef} aria-label="Settings">
        <h1>Settings</h1>
        <button data-tv-focusable="true" className="settings-account" onClick={onSwitchProfile}>
          <span className="settings-account-name">{session.username}</span>
          <small>Switch profile</small>
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
            <span>{entry.label}</span>
            <small>{entry.blurb}</small>
          </button>
        ))}
        <button data-tv-focusable="true" data-settings-signout className="settings-category settings-signout" onClick={() => setConfirmSignOut(true)}>
          <span>Sign Out</span>
        </button>
      </nav>

      <section className="settings-pane" aria-label={categories.find(entry => entry.id === category)?.label}>
        {error && contract ? <p className="settings-error">{error}</p> : null}
        {pane}
      </section>

      {picker && contract ? (
        <ChoicePicker
          title={picker.label}
          choices={picker.key.startsWith("appearance:") ? appearanceOptions[picker.key.slice("appearance:".length)] : choicesFor(picker, contract)}
          current={picker.key === "appearance:posterSize" ? posterSize : picker.key.startsWith("appearance:") ? subtitleAppearance[picker.key.slice("appearance:".length) as keyof SubtitleAppearance] : current}
          onPick={value => picker.key.startsWith("appearance:") ? void chooseAppearance(value) : pick(picker, value)}
          onClose={closePicker}
        />
      ) : null}

      {confirmSignOut ? (
        <div className="details-more-scrim" data-modal="true" onClick={() => setConfirmSignOut(false)}>
          <div className="details-more settings-confirm" role="alertdialog" aria-label="Sign out" onClick={event => event.stopPropagation()}>
            <h2>Sign out?</h2>
            <p>This TV goes back to the sign-in screen. Your profiles and watch history stay on the server.</p>
            <TvButton onClick={onSignOut}>Sign out</TvButton>
            <TvButton className="secondary" onClick={() => setConfirmSignOut(false)}>Cancel</TvButton>
          </div>
        </div>
      ) : null}
    </main>
  );
}
