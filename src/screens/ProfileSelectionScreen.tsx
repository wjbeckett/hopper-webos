import { useEffect, useState } from "react";
import { deleteProfile, getHouseholdProfiles, profileErrorMessage, verifyProfilePin, type HouseholdManager } from "../api/silo";
import { focusFirstContentCard } from "../navigation/spatial";
import type { Session, SiloProfile } from "../types";
import { LoadingState } from "../components/LoadingState";
import { ProfileEditorScreen } from "./ProfileEditorScreen";

/** Android householdPrimary(): the primary profile, else the only one. */
function householdPrimary(profiles: SiloProfile[]): SiloProfile | undefined {
  return profiles.find(profile => profile.isPrimary) ?? (profiles.length === 1 ? profiles[0] : undefined);
}

const isBackKey = (event: KeyboardEvent) =>
  ["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009;

export function ProfileSelectionScreen({ session, onSelect, onChangeServer, onSignOut, onActiveProfileDeleted, fullScreen = false }: {
  /** The deleted profile was this device's selection; its token is now dead server-side. */
  onActiveProfileDeleted?: () => void;
  session: Session;
  onSelect: (profile: SiloProfile, profileToken?: string) => void;
  onChangeServer: () => void;
  onSignOut: () => void;
  fullScreen?: boolean;
}) {
  const [profiles, setProfiles] = useState<SiloProfile[]>([]);
  const [selected, setSelected] = useState<SiloProfile | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  // Manage mode acts as the household primary; null = not managing.
  const [manager, setManager] = useState<HouseholdManager | null>(null);
  // PIN entry is for the primary (to manage) rather than to watch.
  const [pinForManagement, setPinForManagement] = useState(false);
  const [addAfterUnlock, setAddAfterUnlock] = useState(false);
  // Open editor: `{}` = create, `{ profileId }` = edit.
  const [editor, setEditor] = useState<{ profileId?: string } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<SiloProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const primary = householdPrimary(profiles);
  const canManage = primary !== undefined;

  useEffect(() => {
    let alive = true;
    getHouseholdProfiles(session)
      .then(result => { if (alive) setProfiles(result); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load household profiles."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, reloadToken]);

  useEffect(() => {
    if (loading || selected || editor) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, selected, editor, profiles]);

  // Back closes the delete prompt, the editor, then the PIN pad, then leaves manage mode, before the app's Back.
  useEffect(() => {
    if (!editor && !selected && !manager) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      // Backspace inside a text field edits the text; only the remote's Back leaves.
      if (event.key === "Backspace" && event.target instanceof HTMLInputElement) {
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (deleteCandidate) dismissDelete();
      else if (editor) setEditor(null);
      else if (selected) closePin();
      else setManager(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, selected, manager, deleteCandidate, deleting]);

  function closePin() {
    setSelected(null);
    setPin("");
    setError("");
    setPinForManagement(false);
    setAddAfterUnlock(false);
  }

  function startManaging(next: HouseholdManager, thenAdd: boolean) {
    setManager(next);
    if (thenAdd) setEditor({});
  }

  /** Android enterManageMode: verify a PIN-locked primary first. */
  function enterManageMode(thenAdd: boolean) {
    if (!primary) {
      setError("Couldn't find the primary profile needed to manage profiles.");
      return;
    }
    setError("");
    if (primary.hasPin) {
      setSelected(primary);
      setPin("");
      setPinForManagement(true);
      setAddAfterUnlock(thenAdd);
      return;
    }
    startManaging({ profileId: primary.id }, thenAdd);
  }

  /** Closing the prompt hands focus back to the profile's Delete button. */
  function dismissDelete() {
    if (deleting) return;
    const id = deleteCandidate?.id;
    setDeleteCandidate(null);
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-profile-delete="${CSS.escape(id)}"]`)?.focus());
  }

  /** Android confirmDelete: delete, drop a deleted active selection, reload. */
  async function confirmDelete() {
    const profile = deleteCandidate;
    if (!profile || !manager || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await deleteProfile(session, manager, profile.id);
      if (profile.id === session.profileId) onActiveProfileDeleted?.();
      setReloadToken(token => token + 1);
    } catch (cause) {
      setError(profileErrorMessage(cause, "Failed to delete profile"));
    } finally {
      setDeleting(false);
      setDeleteCandidate(null);
    }
  }

  function requestAddProfile() {
    if (manager) setEditor({});
    else enterManageMode(true);
  }

  function chooseProfile(profile: SiloProfile) {
    setError("");
    if (manager) {
      setEditor({ profileId: profile.id });
      return;
    }
    if (!profile.hasPin) {
      onSelect(profile);
      return;
    }
    setSelected(profile);
    setPin("");
  }

  async function submitPin() {
    if (!selected || !pin) return;
    setVerifying(true);
    setError("");
    try {
      const token = await verifyProfilePin(session, selected.id, pin);
      if (pinForManagement) {
        // The primary is never selected; its token only authorises management.
        const thenAdd = addAfterUnlock;
        closePin();
        startManaging({ profileId: selected.id, profileToken: token }, thenAdd);
        return;
      }
      onSelect(selected, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the PIN.");
      setPin("");
    } finally {
      setVerifying(false);
    }
  }

  if (editor && manager) {
    return (
      <ProfileEditorScreen
        key={editor.profileId ?? "new"}
        session={session}
        manager={manager}
        profileId={editor.profileId}
        onCancel={() => setEditor(null)}
        onDone={() => {
          setEditor(null);
          setReloadToken(token => token + 1);
        }}
      />
    );
  }

  if (selected) {
    return (
      <main className={`content-screen profile-selection-screen${fullScreen ? " profile-selection-screen-full" : ""}`}>
        <button data-tv-focusable="true" className="tv-button secondary" onClick={closePin}>‹ Profiles</button>
        <section className="profile-pin-panel">
          <ProfileAvatar profile={selected} />
          <h1>{selected.name}</h1>
          <p>{pinForManagement ? "Enter this PIN to manage profiles" : "Enter this profile’s PIN"}</p>
          <div className="profile-pin-value" aria-live="polite">{pin ? "• ".repeat(pin.length) : "Enter PIN"}</div>
          <div className="profile-pin-pad">
            {"123456789".split("").map(digit => (
              <button key={digit} data-tv-focusable="true" onClick={() => setPin(value => value.length < 8 ? value + digit : value)}>{digit}</button>
            ))}
            <button data-tv-focusable="true" onClick={() => setPin("")}>Clear</button>
            <button data-tv-focusable="true" onClick={() => setPin(value => value.length < 8 ? value + "0" : value)}>0</button>
            <button data-tv-focusable="true" aria-label="Delete last digit" onClick={() => setPin(value => value.slice(0, -1))}>⌫</button>
          </div>
          {error ? <div className="error">{error}</div> : null}
          <button data-tv-focusable="true" className="tv-button" disabled={!pin || verifying} onClick={() => void submitPin()}>{verifying ? "Checking…" : "Continue"}</button>
        </section>
      </main>
    );
  }

  return (
    <main className={`content-screen profile-selection-screen${fullScreen ? " profile-selection-screen-full" : ""}`}>
      <section className="profile-selection-content">
        <header className="profile-selection-heading">
          <h1>{manager ? "Manage Profiles" : "Who's watching?"}</h1>
          <p>{manager ? "Choose a profile to edit." : `Signed in as ${session.username}`}</p>
        </header>
        {error ? <div className="error">{error}</div> : null}
        {loading ? <LoadingState label="Loading profiles" /> : profiles.length ? (
          <div className="profile-selection-grid">
            {profiles.map(profile => (
              <div key={profile.id} className="profile-selection-cell">
                <button
                  type="button"
                  data-tv-focusable="true"
                  data-profile-id={profile.id}
                  className={`profile-selection-card ${manager ? "managing" : ""}`}
                  aria-label={manager ? `Edit ${profile.name}` : `${profile.name}${profile.hasPin ? ", PIN protected" : ""}`}
                  onClick={() => chooseProfile(profile)}
                >
                  <ProfileAvatar profile={profile} />
                  {manager ? <span className="profile-edit-badge" aria-hidden="true">✎</span> : null}
                  <strong>{profile.name}</strong>
                </button>
                {/* The server never deletes the primary (409 primary_profile_protected), so it isn't offered. */}
                {manager && !profile.isPrimary ? (
                  <button
                    type="button"
                    data-tv-focusable="true"
                    data-profile-delete={profile.id}
                    className="tv-button secondary compact profile-delete-button"
                    aria-label={`Delete ${profile.name}`}
                    onClick={() => setDeleteCandidate(profile)}
                  >
                    🗑 Delete
                  </button>
                ) : null}
              </div>
            ))}
            {canManage ? (
              <button
                type="button"
                data-tv-focusable="true"
                className="profile-selection-card profile-add-card"
                aria-label="Add profile"
                onClick={requestAddProfile}
              >
                <span className="profile-avatar-large" aria-hidden="true">+</span>
                <strong>Add Profile</strong>
              </button>
            ) : null}
          </div>
        ) : !error ? <div className="empty-state"><h2>No profiles available</h2></div> : null}
        <footer className="profile-selection-actions">
          {canManage ? (
            <button
              type="button"
              data-tv-focusable="true"
              className="tv-button secondary compact"
              onClick={() => (manager ? setManager(null) : enterManageMode(false))}
            >
              {manager ? "Done" : "Manage"}
            </button>
          ) : null}
          <button type="button" data-tv-focusable="true" className="tv-button secondary compact" onClick={onChangeServer}>Change server</button>
          <button type="button" data-tv-focusable="true" className="tv-button secondary compact" onClick={onSignOut}>Sign out</button>
        </footer>
      </section>
      {deleteCandidate ? (
        // Android TvOptionDialog: Delete profile / Cancel; Back dismisses.
        <div className="details-more-scrim" data-modal="true" onClick={() => dismissDelete()}>
          <div className="details-more" role="dialog" aria-label={`Delete ${deleteCandidate.name}`} onClick={event => event.stopPropagation()}>
            <h2>Delete {deleteCandidate.name}?</h2>
            <button
              type="button"
              data-tv-focusable="true"
              autoFocus
              className="browse-panel-row"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              <span className="browse-panel-row-copy">
                {deleting ? "Deleting…" : "Delete profile"}
                <small>This cannot be undone.</small>
              </span>
            </button>
            <button type="button" data-tv-focusable="true" className="browse-panel-row" disabled={deleting} onClick={() => dismissDelete()}>
              <span>Cancel</span>
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ProfileAvatar({ profile }: { profile: SiloProfile }) {
  return (
    <span className="profile-avatar-large">
      {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.avatarEmoji || profile.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
