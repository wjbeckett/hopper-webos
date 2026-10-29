import { useEffect, useState } from "react";
import { getHouseholdProfiles, verifyProfilePin } from "../api/silo";
import { focusFirstContentCard } from "../navigation/spatial";
import type { Session, SiloProfile } from "../types";

export function ProfileSelectionScreen({ session, onSelect }: {
  session: Session;
  onSelect: (profile: SiloProfile, profileToken?: string) => void;
}) {
  const [profiles, setProfiles] = useState<SiloProfile[]>([]);
  const [selected, setSelected] = useState<SiloProfile | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getHouseholdProfiles(session)
      .then(result => { if (alive) setProfiles(result); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load household profiles."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (loading || selected) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, selected, profiles]);

  function chooseProfile(profile: SiloProfile) {
    setError("");
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
      onSelect(selected, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the PIN.");
      setPin("");
    } finally {
      setVerifying(false);
    }
  }

  if (selected) {
    return (
      <main className="content-screen profile-selection-screen">
        <button data-tv-focusable="true" className="tv-button secondary" onClick={() => { setSelected(null); setPin(""); setError(""); }}>‹ Profiles</button>
        <section className="profile-pin-panel">
          <ProfileAvatar profile={selected} />
          <h1>{selected.name}</h1>
          <p>Enter this profile’s PIN</p>
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
    <main className="content-screen profile-selection-screen">
      {error ? <div className="error">{error}</div> : null}
      {loading ? <div className="screen-state">Loading profiles…</div> : profiles.length ? (
        <div className="profile-selection-grid">
          {profiles.map(profile => (
            <button key={profile.id} data-tv-focusable="true" className="profile-selection-card" onClick={() => chooseProfile(profile)}>
              <ProfileAvatar profile={profile} />
              <strong>{profile.name}</strong>
              {profile.hasPin ? <small>PIN protected</small> : null}
            </button>
          ))}
        </div>
      ) : !error ? <div className="empty-state"><h2>No profiles available</h2></div> : null}
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
