import { useEffect, useRef } from "react";
import type { AssignableLibrary } from "../api/silo";
import { isTvHiddenMediaType } from "../core/tvMediaTypes";
import { AVATAR_STYLES, avatarBatch, parseAvatarRef, avatarImageUrl } from "../core/profileAvatars";
import { ratingCeilingCaption, TV_CONTENT_RATINGS, type AccessLimits } from "../core/profileAccess";

/** Assignable libraries as the form shows them (Android AssignableLibraries). */
export type LibrariesState =
  | { kind: "loading" }
  | { kind: "loaded"; libraries: AssignableLibrary[] }
  | { kind: "failed"; message: string; retrying: boolean };

export type ProfileFormState = {
  title: string;
  subtitle: string;
  name: string;
  /** Stored avatar ref (preset or legacy emoji) and its server URL, for edit. */
  selectedAvatar: string | null;
  selectedAvatarUrl?: string;
  avatarStyleId: string;
  selectedAvatarSeed: string | null;
  avatarBatch: number;
  access: AccessLimits;
  libraries: LibrariesState;
  pinEnabled: boolean;
  pin: string;
  pinHelper: string;
  submitLabel: string;
  isSubmitting: boolean;
  error: string | null;
};

export type ProfileFormCallbacks = {
  onNameChanged: (value: string) => void;
  onAvatarStyleSelected: (styleId: string) => void;
  onAvatarPresetSelected: (styleId: string, seed: string, ref: string) => void;
  onAvatarShuffle: () => void;
  onChildToggled: (child: boolean) => void;
  onContentRatingSelected: (rating: string | null) => void;
  onLibraryRestrictionsToggled: (restricted: boolean) => void;
  onLibraryToggled: (id: number, allowed: boolean) => void;
  onRetryLibraries: () => void;
  onPinToggled: (enabled: boolean) => void;
  onPinChanged: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
};

/** Allowlist rows under "Choose libraries"; ebook-like libraries are hidden on TV (Android visibleOnTv). */
function LibraryChoices({ state, callbacks }: { state: ProfileFormState; callbacks: ProfileFormCallbacks }) {
  const libraries = state.libraries;
  if (libraries.kind === "loading") return <small className="profile-form-caption">Loading libraries…</small>;
  if (libraries.kind === "failed") {
    return (
      <div className="profile-form-retry">
        <small className="profile-form-caption">{`Couldn't load libraries. ${libraries.message}`.trim()}</small>
        {/* Stays mounted while retrying so focus doesn't jump. */}
        <button type="button" data-tv-focusable="true" className="tv-button secondary compact" onClick={() => { if (!libraries.retrying) callbacks.onRetryLibraries(); }}>
          {libraries.retrying ? "Loading…" : "↻ Try Again"}
        </button>
      </div>
    );
  }
  const shown = libraries.libraries.filter(library => !isTvHiddenMediaType(library.type));
  if (!shown.length) return <small className="profile-form-caption">No libraries are available to assign.</small>;
  return (
    <div className="profile-form-libraries">
      {shown.map(library => {
        const allowed = state.access.allowedLibraryIds.includes(library.id);
        return (
          <button
            key={library.id}
            type="button"
            data-tv-focusable="true"
            role="checkbox"
            aria-checked={allowed}
            className={`browse-panel-row ${allowed ? "selected" : ""}`}
            onClick={() => callbacks.onLibraryToggled(library.id, !allowed)}
          >
            <span className="browse-panel-check">{allowed ? "✓" : ""}</span>
            <span>{library.name}</span>
            <span className="browse-panel-direction">{allowed ? "Allowed" : "Not allowed"}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The image the preview tile shows, mirroring Android previewAvatarRef. */
function previewImage(state: ProfileFormState): string | null {
  if (state.avatarStyleId === "initials") return avatarImageUrl("initials", state.name.trim() || "You");
  if (state.selectedAvatarSeed) return avatarImageUrl(state.avatarStyleId, state.selectedAvatarSeed);
  const stored = parseAvatarRef(state.selectedAvatar);
  if (stored && stored.styleId === state.avatarStyleId) return stored.previewUrl;
  if (state.selectedAvatar && !stored && state.selectedAvatarUrl) return state.selectedAvatarUrl;
  return avatarBatch(state.avatarStyleId, state.avatarBatch)[0]?.previewUrl ?? null;
}

export function ProfileForm({ state, callbacks }: { state: ProfileFormState; callbacks: ProfileFormCallbacks }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const preview = previewImage(state);
  const presets = avatarBatch(state.avatarStyleId, state.avatarBatch);
  const access = state.access;

  // Initial focus: the name field (Android focuses the form on entry).
  useEffect(() => {
    const frame = requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <main className="content-screen profile-form-screen">
      <header className="profile-form-header">
        <div>
          <h1>{state.title}</h1>
          <p>{state.subtitle}</p>
        </div>
        {callbacks.onCancel ? (
          <button type="button" data-tv-focusable="true" className="tv-button secondary compact" onClick={callbacks.onCancel}>
            × Cancel
          </button>
        ) : null}
      </header>
      <div className="profile-form-body">
        <aside className="profile-form-preview" aria-hidden="true">
          <span className="profile-avatar-large">
            {preview ? <img src={preview} alt="" /> : (state.name.trim().slice(0, 1).toUpperCase() || "?")}
          </span>
          <strong>{state.name.trim() || "Your Name"}</strong>
          <span className="profile-form-badges">
            {state.pinEnabled ? <span>🔒 PIN</span> : null}
            {access.isChild ? <span>Child</span> : null}
          </span>
          <small>Your tile will look like this.</small>
        </aside>
        <div className="profile-form">
          <section className="profile-form-section">
            <h2>Style</h2>
            <div className="profile-form-chips">
              {AVATAR_STYLES.map(style => (
                <button
                  key={style.id}
                  type="button"
                  data-tv-focusable="true"
                  aria-pressed={style.id === state.avatarStyleId}
                  className={`library-view-tab ${style.id === state.avatarStyleId ? "active" : ""}`}
                  onClick={() => callbacks.onAvatarStyleSelected(style.id)}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </section>

          <section className="profile-form-section">
            <div className="profile-form-section-head">
              <h2>Avatar</h2>
              {state.avatarStyleId !== "initials" ? (
                <button type="button" data-tv-focusable="true" className="tv-button secondary compact" onClick={callbacks.onAvatarShuffle}>
                  ↻ Shuffle
                </button>
              ) : null}
            </div>
            {state.avatarStyleId === "initials" ? (
              <p className="profile-form-hint">
                <strong>Uses your profile name</strong>
                The first letters of the name below appear on your tile.
              </p>
            ) : (
              <div className="profile-form-avatar-grid">
                {presets.map(preset => {
                  const selected = preset.seed === state.selectedAvatarSeed;
                  return (
                    <button
                      key={`${preset.styleId}:${preset.seed}`}
                      type="button"
                      data-tv-focusable="true"
                      aria-pressed={selected}
                      aria-label={preset.seed.replace("-", " ")}
                      className={`profile-form-avatar ${selected ? "selected" : ""}`}
                      onClick={() => callbacks.onAvatarPresetSelected(preset.styleId, preset.seed, preset.ref)}
                    >
                      <img src={preset.previewUrl} alt="" loading="lazy" />
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="profile-form-section">
            <h2>Name</h2>
            <input
              ref={nameRef}
              data-tv-focusable="true"
              className="profile-form-input"
              value={state.name}
              maxLength={50}
              placeholder="Profile name"
              aria-label="Profile name"
              onChange={event => callbacks.onNameChanged(event.target.value)}
            />
          </section>

          <section className="profile-form-section">
            <div className="profile-form-section-head">
              <h2>PIN (optional)</h2>
              {state.pinEnabled ? (
                <button type="button" data-tv-focusable="true" className="tv-button secondary compact" onClick={() => callbacks.onPinToggled(false)}>
                  × Remove
                </button>
              ) : null}
            </div>
            <input
              data-tv-focusable="true"
              className="profile-form-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={state.pin}
              placeholder={state.pinHelper}
              aria-label={state.pinHelper}
              // Typing a PIN turns it on, as Android's PIN field does.
              onChange={event => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
                if (!state.pinEnabled && digits) callbacks.onPinToggled(true);
                callbacks.onPinChanged(digits);
              }}
            />
          </section>

          <button
            type="button"
            data-tv-focusable="true"
            role="switch"
            aria-checked={access.isChild}
            className="profile-form-switch"
            onClick={() => callbacks.onChildToggled(!access.isChild)}
          >
            <span>
              <strong>Child Profile</strong>
              <small>Fills in kid-friendly limits below</small>
            </span>
            <span className={`profile-form-toggle ${access.isChild ? "on" : ""}`} aria-hidden="true" />
          </button>

          <section className="profile-form-panel">
            <h3>Maximum rating</h3>
            <div className="profile-form-ladder">
              {[...TV_CONTENT_RATINGS, null].map(rating => {
                const selected = rating === access.maxContentRating;
                return (
                  <button
                    key={rating ?? "any"}
                    type="button"
                    data-tv-focusable="true"
                    aria-pressed={selected}
                    className={`profile-form-segment ${selected ? "selected" : ""}`}
                    onClick={() => callbacks.onContentRatingSelected(rating)}
                  >
                    {rating ?? "Any"}
                  </button>
                );
              })}
            </div>
            <small className="profile-form-caption">{ratingCeilingCaption(access.maxContentRating)}</small>

            <h3>Libraries</h3>
            <div className="profile-form-ladder">
              {([[false, "All libraries"], [true, "Choose libraries"]] as const).map(([restricted, label]) => (
                <button
                  key={label}
                  type="button"
                  data-tv-focusable="true"
                  aria-pressed={access.libraryRestrictionsEnabled === restricted}
                  className={`profile-form-segment ${access.libraryRestrictionsEnabled === restricted ? "selected" : ""}`}
                  onClick={() => callbacks.onLibraryRestrictionsToggled(restricted)}
                >
                  {label}
                </button>
              ))}
            </div>
            {access.libraryRestrictionsEnabled ? <LibraryChoices state={state} callbacks={callbacks} /> : null}
          </section>

          {state.error ? <div className="error" role="alert">{state.error}</div> : null}
          <button
            type="button"
            data-tv-focusable="true"
            className="tv-button profile-form-submit"
            disabled={state.isSubmitting}
            onClick={callbacks.onSubmit}
          >
            ✓ {state.isSubmitting ? "Saving..." : state.submitLabel}
          </button>
        </div>
      </div>
    </main>
  );
}
