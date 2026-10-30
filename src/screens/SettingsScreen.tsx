import { useEffect, useMemo, useRef, useState } from "react";
import { clearSetting, getEffectiveSettings, getSettingsContract, putSetting } from "../api/settings";
import type { SettingDefinition, SettingOption, SettingsContract } from "../api/settings";
import { clientIdentity } from "../platform/device";
import { LoadingState } from "../components/LoadingState";
import { TvButton } from "../components/TvButton";
import type { Session } from "../types";

type Category = "playback" | "subtitles" | "server";
type Choice = { label: string; value: unknown; detail?: string };

const categories: Array<{ id: Category; label: string; blurb: string }> = [
  { id: "playback", label: "Playback", blurb: "Quality and episodes" },
  { id: "subtitles", label: "Subtitles", blurb: "Language and behavior" },
  { id: "server", label: "Server", blurb: "Connection and account" }
];

const keysByCategory: Record<Exclude<Category, "server">, Array<{ title: string; keys: string[] }>> = {
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
    setPicker(null);
    const key = returnFocusRef.current;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-setting-key='${key}']`)?.focus());
  }

  function pick(definition: SettingDefinition, value: unknown) {
    void save(definition, value);
    closePicker();
  }

  const renderGroups = (groups: Array<{ title: string; keys: string[] }>) => groups.map(group => {
    const rows = group.keys.map(key => definitions.get(key)).filter((definition): definition is SettingDefinition => Boolean(definition));
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
  } else {
    pane = renderGroups(keysByCategory[category]);
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
          choices={choicesFor(picker, contract)}
          current={current}
          onPick={value => pick(picker, value)}
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
