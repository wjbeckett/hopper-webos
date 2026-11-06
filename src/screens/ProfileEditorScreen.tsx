import { useCallback, useEffect, useRef, useState } from "react";
import {
  createProfile,
  getAssignableLibraries,
  getEditableProfiles,
  profileErrorMessage,
  updateProfile,
  type EditableProfile,
  type HouseholdManager
} from "../api/silo";
import { LoadingState } from "../components/LoadingState";
import { ProfileForm, type LibrariesState } from "../components/ProfileForm";
import { DEFAULT_AVATAR_STYLE, effectiveAvatarRef, parseAvatarRef } from "../core/profileAvatars";
import {
  CHOOSE_A_LIBRARY_MESSAGE,
  EMPTY_ACCESS,
  createAccessFields,
  hasProfileNamed,
  needsLibrary,
  updateAccessFields,
  withChild,
  withLibrary,
  type AccessLimits
} from "../core/profileAccess";
import type { Session } from "../types";

/** `profileId` absent = Create (TvCreateProfileViewModel), present = Edit (TvEditProfileViewModel). */
export function ProfileEditorScreen({ session, manager, profileId, onDone, onCancel }: {
  session: Session;
  manager: HouseholdManager;
  profileId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = profileId !== undefined;
  const [loading, setLoading] = useState(editing);
  const [name, setName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string>();
  const [avatarStyleId, setAvatarStyleId] = useState(DEFAULT_AVATAR_STYLE);
  const [selectedAvatarSeed, setSelectedAvatarSeed] = useState<string | null>(null);
  const [batch, setBatch] = useState(0);
  const [access, setAccess] = useState<AccessLimits>(EMPTY_ACCESS);
  const [libraries, setLibraries] = useState<LibrariesState>({ kind: "loading" });
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Loaded state an edit compares against (Android loadedHasPin / loadedAccess).
  const existing = useRef<EditableProfile[]>([]);
  const loadedHasPin = useRef(false);
  const loadedAccess = useRef<AccessLimits>(EMPTY_ACCESS);

  const loadLibraries = useCallback(() => {
    setLibraries(current => current.kind === "failed" ? { ...current, retrying: true } : { kind: "loading" });
    getAssignableLibraries(session)
      .then(result => setLibraries({ kind: "loaded", libraries: result }))
      .catch(() => setLibraries({ kind: "failed", message: "", retrying: false }));
  }, [session]);

  useEffect(() => {
    let alive = true;
    loadLibraries();
    getEditableProfiles(session)
      .then(profiles => {
        if (!alive) return;
        existing.current = profiles;
        if (!editing) return;
        const profile = profiles.find(candidate => candidate.id === profileId);
        if (!profile) {
          setError("Profile not found");
          return;
        }
        const loaded: AccessLimits = {
          ...EMPTY_ACCESS,
          isChild: profile.isChild,
          maxContentRating: profile.maxContentRating,
          libraryRestrictionsEnabled: profile.libraryRestrictionsEnabled,
          allowedLibraryIds: profile.allowedLibraryIds
        };
        const preset = parseAvatarRef(profile.avatarEmoji);
        loadedHasPin.current = profile.hasPin;
        loadedAccess.current = loaded;
        setName(profile.name);
        setSelectedAvatar(profile.avatarEmoji ?? null);
        setSelectedAvatarUrl(profile.avatarUrl);
        setAvatarStyleId(preset?.styleId ?? DEFAULT_AVATAR_STYLE);
        setSelectedAvatarSeed(preset?.seed ?? null);
        setAccess(loaded);
        setPinEnabled(profile.hasPin);
      })
      // Create: the list is only a best-effort duplicate pre-check; the server still enforces it.
      .catch(() => { if (alive && editing) setError("Failed to load profile"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [editing, loadLibraries, profileId, session]);

  async function submit() {
    if (submitting) return;
    if (!name.trim()) return setError("Profile name is required");
    if (hasProfileNamed(existing.current, name, profileId)) return setError("A profile with this name already exists");
    // Create needs 4 digits once a PIN is on; edit allows blank to keep the stored PIN.
    const pinInvalid = editing ? pin.length > 0 && pin.length !== 4 : pin.length !== 4;
    if (pinEnabled && pinInvalid) return setError("PIN must be 4 digits");
    const assignable = libraries.kind === "loaded" ? libraries.libraries.map(library => library.id) : null;
    if (needsLibrary(access, editing ? loadedAccess.current : null, assignable)) return setError(CHOOSE_A_LIBRARY_MESSAGE);

    const avatar = effectiveAvatarRef({ styleId: avatarStyleId, selectedSeed: selectedAvatarSeed, batch, name, fallbackAvatar: selectedAvatar });
    setSubmitting(true);
    setError(null);
    try {
      if (editing && profileId) {
        // A new PIN sets it; turning off a stored PIN clears it (PATCH null); otherwise omit.
        const patch: Record<string, unknown> = { name, ...updateAccessFields(access, loadedAccess.current, assignable) };
        if (avatar) patch.avatar = avatar;
        if (pinEnabled && pin) patch.pin = pin;
        else if (!pinEnabled && loadedHasPin.current) patch.pin = null;
        await updateProfile(session, manager, profileId, patch);
      } else {
        await createProfile(session, manager, { name, avatar, pin: pinEnabled ? pin : null, ...createAccessFields(access) });
      }
      onDone();
    } catch (cause) {
      setError(profileErrorMessage(cause, editing ? "Failed to update profile" : "Failed to create profile"));
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading profile" />;

  return (
    <ProfileForm
      state={{
        title: editing ? "Edit Profile" : "New Profile",
        subtitle: editing ? "Pick a look and update this profile." : "Pick a look for this profile.",
        name,
        selectedAvatar,
        selectedAvatarUrl,
        avatarStyleId,
        selectedAvatarSeed,
        avatarBatch: batch,
        access,
        libraries,
        pinEnabled,
        pin,
        pinHelper: editing ? "New 4-Digit PIN (leave blank to keep)" : "4-Digit PIN",
        submitLabel: editing ? "Save Changes" : "Create Profile",
        isSubmitting: submitting,
        error
      }}
      callbacks={{
        onNameChanged: value => { setName(value); setError(null); },
        onAvatarStyleSelected: styleId => { setAvatarStyleId(styleId); setSelectedAvatar(null); setSelectedAvatarSeed(null); setBatch(0); },
        onAvatarPresetSelected: (styleId, seed, ref) => { setAvatarStyleId(styleId); setSelectedAvatar(ref); setSelectedAvatarSeed(seed); },
        onAvatarShuffle: () => { setBatch(value => value + 1); setSelectedAvatar(null); setSelectedAvatarSeed(null); },
        onChildToggled: child => { setAccess(current => withChild(current, child)); setError(null); },
        onContentRatingSelected: rating => setAccess(current => ({ ...current, maxContentRating: rating, ratingTouched: true })),
        onLibraryRestrictionsToggled: restricted => {
          setAccess(current => ({ ...current, libraryRestrictionsEnabled: restricted, librariesTouched: true }));
          setError(null);
        },
        onLibraryToggled: (id, allowed) => { setAccess(current => withLibrary(current, id, allowed)); setError(null); },
        onRetryLibraries: loadLibraries,
        onPinToggled: enabled => { setPinEnabled(enabled); if (!enabled) setPin(""); },
        onPinChanged: value => { setPin(value.replace(/\D/g, "").slice(0, 4)); setError(null); },
        onSubmit: () => void submit(),
        onCancel
      }}
    />
  );
}
