export type AppSection = "home" | "library" | "movies" | "series" | "music" | "audiobooks" | "search" | "favorites" | "watchlist" | "settings";

export type NavSection = { id: AppSection; label: string };

export function TopNav({
  active,
  sections,
  username,
  session,
  onSelect,
  onProfile,
  onFavorites,
  onWatchlist
}: {
  active: AppSection;
  sections: NavSection[];
  username: string;
  session: Session;
  onSelect: (section: AppSection) => void;
  onProfile: () => void;
  onFavorites: () => void;
  onWatchlist: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <header className="tv-nav">
      <div className="brand-mark">S</div>
      <nav>
        {sections.map((section) => (
          <button
            key={section.id}
            data-tv-focusable="true"
            className={`nav-item ${active === section.id ? "active" : ""}`}
            aria-current={active === section.id ? "page" : undefined}
            onClick={() => onSelect(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>
      <div className="profile-menu-anchor">
        <button data-tv-focusable="true" className="profile-pill" onClick={() => setProfileOpen((open) => !open)} aria-label={`${username} profile menu`}>
          <ProfileAvatar session={session} />
        </button>
        {profileOpen ? (
          <div className="profile-menu">
            <div className="profile-menu-name">{username}</div>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onWatchlist(); }}>▣ Watchlist</button>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onFavorites(); }}>♥ Favorites</button>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onProfile(); }}>⚙ Settings</button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function ProfileAvatar({ session }: { session: Session }) {
  const value = session.profileAvatar?.trim() ?? "";
  const source = avatarImageUrl(value, session.serverUrl);
  const [image, setImage] = useState("");
  const fallback = source ? session.username.slice(0, 1).toUpperCase() : value || session.username.slice(0, 1).toUpperCase();

  useEffect(() => {
    setImage("");
    if (!source) return;
    if (!isSiloAsset(value)) {
      setImage(source);
      return;
    }

    let active = true;
    let objectUrl = "";
    fetch(source, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
        ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {})
      }
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Avatar request failed: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setImage(objectUrl);
      })
      .catch(() => { if (active) setImage(""); });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, value, session.accessToken, session.profileId, session.profileToken]);

  return (
    <span className="profile-avatar-frame">
      <span className="profile-avatar-text">{fallback}</span>
      {image ? (
        <img
          className="profile-avatar-image"
          src={image}
          alt=""
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
      ) : null}
    </span>
  );
}

function isSiloAsset(value: string) {
  return Boolean(value) && !/^(https?:|data:image\/|preset:dicebear:)/i.test(value);
}

function avatarImageUrl(value: string, serverUrl: string) {
  if (!value) return "";
  if (value.toLowerCase().startsWith("preset:dicebear:")) {
    const [, , style, seed] = value.split(":", 4);
    if (!style || !seed) return "";
    return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/png?seed=${encodeURIComponent(seed)}&size=256`;
  }
  if (/^(https?:|data:image\/)/i.test(value)) return value;
  const isImage = value.startsWith("/") || value.includes("/") || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(value);
  if (!isImage) return "";
  return `${serverUrl.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}
import { useEffect, useState } from "react";
import type { Session } from "../types";
