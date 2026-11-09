export type AppSection = "home" | "forYou" | "calendar" | "requests" | "library" | "collections" | "movies" | "series" | "music" | "audiobooks" | "search" | "favorites" | "watchlist" | "history" | "profiles" | "settings";
export type LibraryLanding = "recommended" | "browse" | "collections" | "authors" | "series" | "alphabet";

import { HopperLockup } from "./HopperMark";

type PrimaryNavId = "home" | "movies" | "series" | "music" | "audiobooks" | "forYou" | "calendar" | "requests" | "search";

export function TopNav({
  active,
  libraries,
  requestsAvailable,
  username,
  session,
  onSelect,
  onProfile,
  onFavorites,
  onWatchlist,
  onLibraries,
  onHistory,
  onProfiles,
  onSignOut,
  onChangeServer
}: {
  active: AppSection;
  libraries: SiloLibrary[];
  requestsAvailable?: boolean;
  username: string;
  session: Session;
  onSelect: (section: AppSection, libraryId?: number, landing?: LibraryLanding) => void;
  onProfile: () => void;
  onFavorites: () => void;
  onWatchlist: () => void;
  onLibraries: () => void;
  onHistory: () => void;
  onProfiles: () => void;
  onSignOut: () => void;
  onChangeServer: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<PrimaryNavId | null>(null);
  const [openSeriesLibrary, setOpenSeriesLibrary] = useState<number | null>(null);
  const serverName = serverRegistry.active()?.name ?? (() => {
    try { return new URL(session.serverUrl).hostname; } catch { return "Silo"; }
  })();
  const profileRole = username.toLowerCase().includes("admin") ? "Administrator" : "Profile";
  const profileSubtitle = `${profileRole.toUpperCase()} · ${serverName.toUpperCase()}`;
  const musicLibraries = libraries.filter(library => {
    const type = library.type.replace(/[\s_-]/g, "").toLowerCase();
    return ["music", "audio"].includes(type);
  });
  const audiobookLibraries = libraries.filter(library => {
    const type = library.type.replace(/[\s_-]/g, "").toLowerCase();
    return ["audiobook", "audiobooks"].includes(type);
  });
  const movieLibraries = libraries.filter(library => {
    const type = library.type.replace(/[\s_-]/g, "").toLowerCase();
    return ["movie", "movies", "mixed"].includes(type);
  });
  const seriesLibraries = libraries.filter(library => {
    const type = library.type.replace(/[\s_-]/g, "").toLowerCase();
    return ["series", "show", "shows", "tv", "mixed"].includes(type);
  });
  const [collectionsPresent, setCollectionsPresent] = useState<Record<number, boolean>>({});
  const librariesKey = libraries.map(library => library.id).join(",");
  const hasCollections = (candidates: SiloLibrary[]) => candidates.length === 0 || candidates.some(library => collectionsPresent[library.id] !== false);
  const navItems: { id: PrimaryNavId; label: string }[] = [
    { id: "search", label: "Search" },
    { id: "home", label: "Home" },
    ...(movieLibraries.length ? [{ id: "movies" as const, label: "Movies" }] : []),
    ...(seriesLibraries.length ? [{ id: "series" as const, label: "Series" }] : []),
    ...(musicLibraries.length ? [{ id: "music" as const, label: "Music" }] : []),
    ...(audiobookLibraries.length ? [{ id: "audiobooks" as const, label: "Audiobooks" }] : []),
    { id: "forYou", label: "For You" },
    { id: "calendar", label: "Calendar" },
    ...(requestsAvailable === false ? [] : [{ id: "requests" as const, label: "Requests" }])
  ];

  useEffect(() => {
    let alive = true;
    for (const library of libraries) {
      getLibraryCollectionSections(session, library.id)
        .then(sections => { if (alive) setCollectionsPresent(current => ({ ...current, [library.id]: sections.length > 0 })); })
        .catch(() => undefined);
    }
    return () => { alive = false; };
  }, [session, librariesKey]);

  useEffect(() => {
    const closeMenu = () => {
      setOpenMenu(null);
      setOpenSeriesLibrary(null);
    };
    window.addEventListener("silo:close-nav-callout", closeMenu);
    return () => window.removeEventListener("silo:close-nav-callout", closeMenu);
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const menu = document.querySelector<HTMLElement>(".profile-menu");
    menu?.querySelector<HTMLElement>('[data-profile-menu-item="switch-profile"]')?.focus();
    const closeProfile = () => {
      setProfileOpen(false);
      document.querySelector<HTMLElement>(".profile-pill")?.focus();
    };
    window.addEventListener("silo:close-profile-menu", closeProfile);
    return () => window.removeEventListener("silo:close-profile-menu", closeProfile);
  }, [profileOpen]);

  function handleProfileAction(action: () => void) {
    setProfileOpen(false);
    action();
  }

  function showMenu(id: PrimaryNavId) {
    setOpenMenu(["movies", "series", "music", "audiobooks", "forYou"].includes(id) ? id : null);
    if (id !== "series") setOpenSeriesLibrary(null);
  }

  function selectSection(section: AppSection, libraryId?: number, landing: LibraryLanding = "recommended") {
    setOpenMenu(null);
    setOpenSeriesLibrary(null);
    onSelect(section, libraryId, landing);
  }

  return (
    <header
      className="tv-nav"
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setOpenMenu(null);
          setOpenSeriesLibrary(null);
          setProfileOpen(false);
        }
      }}
    >
      <div className="brand-mark" role="img" aria-label="Hopper">
        <HopperLockup />
      </div>
      <nav aria-label="Primary navigation">
        {navItems.map((item) => {
          const isActive = active === item.id
            || (item.id === "forYou" && (active === "favorites" || active === "watchlist"))
            || (item.id === "search" && active === "search");
          return (
            <div
              key={item.id}
              className={`nav-entry nav-entry-${item.id}`}
              data-nav-entry={item.id}
              onMouseEnter={() => showMenu(item.id)}
            >
              <button
                type="button"
                data-tv-focusable="true"
                data-nav-primary={item.id}
                className={`nav-item ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.id === "search" ? "Search" : undefined}
                aria-haspopup={["movies", "series", "music", "audiobooks", "forYou"].includes(item.id) ? "menu" : undefined}
                aria-expanded={openMenu === item.id}
                onFocus={() => showMenu(item.id)}
                onClick={() => selectSection(item.id)}
              >
                {item.id === "search" ? (
                  <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                    <circle cx="10.8" cy="10.8" r="6.3" />
                    <path d="m15.4 15.4 4.2 4.2" />
                  </svg>
                ) : item.label}
              </button>
              {openMenu === item.id && item.id === "movies" ? (
                <div className="nav-callout" role="menu" aria-label="Movies">
                  <div className="nav-callout-header">Movies</div>
                  <div data-nav-callout-group>
                    <CalloutButton icon="sparkles" onClick={() => selectSection("movies", undefined, "recommended")}>Recommended</CalloutButton>
                    <CalloutButton icon="grid" onClick={() => selectSection("movies", undefined, "browse")}>Browse</CalloutButton>
                    {hasCollections(movieLibraries) ? <CalloutButton icon="collections" onClick={() => selectSection("movies", undefined, "collections")}>Collections</CalloutButton> : null}
                  </div>
                </div>
              ) : null}
              {openMenu === item.id && item.id === "music" ? (
                <div className="nav-callout" role="menu" aria-label="Music">
                  <div className="nav-callout-header">Music</div>
                  <div data-nav-callout-group>
                    <CalloutButton icon="sparkles" onClick={() => selectSection("music", undefined, "recommended")}>Recommended</CalloutButton>
                    <CalloutButton icon="grid" onClick={() => selectSection("music", undefined, "browse")}>Browse</CalloutButton>
                  </div>
                </div>
              ) : null}
              {openMenu === item.id && item.id === "audiobooks" ? (
                <div className="nav-callout" role="menu" aria-label="Audiobooks">
                  <div className="nav-callout-header">Audiobooks</div>
                  <div data-nav-callout-group>
                    <CalloutButton icon="sparkles" onClick={() => selectSection("audiobooks", undefined, "recommended")}>Recommended</CalloutButton>
                    <CalloutButton icon="grid" onClick={() => selectSection("audiobooks", undefined, "browse")}>Browse</CalloutButton>
                    <CalloutButton icon="series" onClick={() => selectSection("audiobooks", undefined, "authors")}>Authors</CalloutButton>
                    <CalloutButton icon="collections" onClick={() => selectSection("audiobooks", undefined, "series")}>Series</CalloutButton>
                    {hasCollections(audiobookLibraries) ? <CalloutButton icon="collections" onClick={() => selectSection("audiobooks", undefined, "collections")}>Collections</CalloutButton> : null}
                    <CalloutButton icon="grid" onClick={() => selectSection("audiobooks", undefined, "alphabet")}>A-Z</CalloutButton>
                  </div>
                </div>
              ) : null}
              {openMenu === item.id && item.id === "series" ? (
                <div className="nav-callout nav-series-callout" role="menu" aria-label="Series libraries">
                  <div className="nav-callout-header">TV Libraries</div>
                  <div data-nav-callout-group>
                    {seriesLibraries.map((library) => (
                      <div className="nav-series-entry" key={library.id} data-nav-series-entry={library.id}>
                        <button
                          type="button"
                          role="menuitem"
                          data-tv-focusable="true"
                          data-nav-callout-item="true"
                          data-nav-series-library={library.id}
                          aria-haspopup="menu"
                          aria-expanded={openSeriesLibrary === library.id}
                          onFocus={() => setOpenSeriesLibrary(library.id)}
                          onMouseEnter={() => setOpenSeriesLibrary(library.id)}
                          onClick={() => setOpenSeriesLibrary(library.id)}
                        >
                          <CalloutIcon name="series" />
                          <span>{library.name}</span>
                          <CalloutIcon name="chevron" />
                        </button>
                        {openSeriesLibrary === library.id ? (
                          <div className="nav-callout nav-series-subcallout" role="menu" aria-label={`${library.name} options`}>
                            <div className="nav-callout-header">{library.name}</div>
                            <div data-nav-callout-group>
                              <CalloutButton icon="sparkles" onClick={() => selectSection("series", library.id, "recommended")}>Recommended</CalloutButton>
                              <CalloutButton icon="grid" onClick={() => selectSection("series", library.id, "browse")}>Browse</CalloutButton>
                              {hasCollections([library]) ? <CalloutButton icon="collections" onClick={() => selectSection("series", library.id, "collections")}>Collections</CalloutButton> : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {!seriesLibraries.length ? <span className="nav-callout-empty">No Series libraries</span> : null}
                  </div>
                </div>
              ) : null}
              {openMenu === item.id && item.id === "forYou" ? (
                <div className="nav-callout" role="menu" aria-label="For You">
                  <div className="nav-callout-header">For You</div>
                  <div data-nav-callout-group>
                    <CalloutButton icon="sparkles" onClick={() => selectSection("forYou")}>Recommendations</CalloutButton>
                    <CalloutButton icon="heart" onClick={() => selectSection("favorites")}>Favorites</CalloutButton>
                    <CalloutButton icon="bookmark" onClick={() => selectSection("watchlist")}>Watchlist</CalloutButton>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <div className="profile-menu-anchor">
        <button data-tv-focusable="true" className="profile-pill" onClick={() => setProfileOpen((open) => !open)} aria-label={`${username} profile menu`}>
          <ProfileAvatar session={session} />
        </button>
        {profileOpen ? (
          <div className="profile-menu" data-modal="true" role="menu" aria-label={`${username} profile menu`}>
            <div className="profile-menu-header">
              <div className="profile-menu-avatar">
                <ProfileAvatar session={session} />
              </div>
              <div className="profile-menu-meta">
                <div className="profile-menu-name">{username}</div>
                <div className="profile-menu-subtitle">{profileSubtitle}</div>
              </div>
            </div>
            <div className="profile-menu-divider" />
            <button type="button" className="profile-menu-item" data-tv-focusable="true" data-profile-menu-item="switch-profile" onClick={() => handleProfileAction(onProfiles)}><ProfileMenuIcon name="switch-profile" /><span>Switch Profile</span></button>
            <button type="button" className="profile-menu-item" data-tv-focusable="true" onClick={() => handleProfileAction(onWatchlist)}><ProfileMenuIcon name="watchlist" /><span>Watchlist</span></button>
            <button type="button" className="profile-menu-item" data-tv-focusable="true" onClick={() => handleProfileAction(onFavorites)}><ProfileMenuIcon name="favorites" /><span>Favorites</span></button>
            <button type="button" className="profile-menu-item" data-tv-focusable="true" onClick={() => handleProfileAction(onHistory)}><ProfileMenuIcon name="history" /><span>History</span></button>
            <div className="profile-menu-divider" />
            <button type="button" className="profile-menu-item" data-tv-focusable="true" onClick={() => handleProfileAction(onProfile)}><ProfileMenuIcon name="settings" /><span>Settings</span></button>
            <button type="button" className="profile-menu-item" data-tv-focusable="true" onClick={() => handleProfileAction(onChangeServer)}><ProfileMenuIcon name="server" /><span>Switch Server</span></button>
            <button type="button" className="profile-menu-item profile-menu-item-danger" data-tv-focusable="true" onClick={() => handleProfileAction(onSignOut)}><ProfileMenuIcon name="sign-out" /><span>Sign Out</span></button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function ProfileMenuIcon({ name }: { name: "switch-profile" | "watchlist" | "favorites" | "history" | "settings" | "server" | "sign-out" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    "switch-profile": <><path d="M8 7h9a3 3 0 0 1 0 6H9" /><path d="m11 4-3 3 3 3" /><path d="M16 17H7a3 3 0 0 1 0-6h9" /><path d="m13 20 3-3-3-3" /></>,
    watchlist: <path d="M7 4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V20l-5-3.5L7 20V4.5Z" />,
    favorites: <path d="M12 20s-7-4.35-7-10A4.5 4.5 0 0 1 12 7.25 4.5 4.5 0 0 1 19 10c0 5.65-7 10-7 10Z" />,
    history: <><path d="M4 12a8 8 0 1 1 13.8 5.2" /><path d="M4 4v5h5" /><path d="M12 8v5l3.5 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.7l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.7-.3 1.7 1.7 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.7l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.7-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 9c.4.3.8.9.8 1.5v.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
    server: <><path d="M5 12h14" /><path d="M7 7h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><path d="M8 10h8" /></>,
    "sign-out": <><path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h6.4A1.8 1.8 0 0 1 19 5.8v12.4A1.8 1.8 0 0 1 17.2 20h-6.4A1.8 1.8 0 0 1 9 18.2V17" /><path d="M14 12H4" /><path d="m8 8 4 4-4 4" /></>,
  };

  return (
    <svg
      className="profile-menu-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

function CalloutButton({
  children,
  icon,
  onClick
}: {
  children: string;
  icon: "sparkles" | "grid" | "collections" | "heart" | "bookmark" | "series";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-tv-focusable="true"
      data-nav-callout-item="true"
      onClick={onClick}
    >
      <CalloutIcon name={icon} />
      <span>{children}</span>
    </button>
  );
}

function CalloutIcon({ name }: { name: "sparkles" | "grid" | "collections" | "heart" | "bookmark" | "series" | "chevron" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    sparkles: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    collections: <><rect x="7" y="4" width="13" height="15" rx="2" /><path d="M4 8v12a2 2 0 0 0 2 2h11" /></>,
    heart: <path d="M20.8 8.8c0 5.1-8.8 10.1-8.8 10.1S3.2 13.9 3.2 8.8A4.3 4.3 0 0 1 11 6.1l1 1 1-1a4.3 4.3 0 0 1 7.8 2.7Z" />,
    bookmark: <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.8L6 21V4.5Z" />,
    series: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m8 2-2 3m10-3-2 3" /></>,
    chevron: <path d="m9 6 6 6-6 6" />
  };
  const filled = name === "heart" || name === "bookmark";

  return (
    <svg
      className={`nav-callout-icon nav-callout-icon-${name}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export function ProfileAvatar({ session }: { session: Session }) {
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
import { getLibraryCollectionSections } from "../api/silo";
import { serverRegistry } from "../core/serverRegistry";
import type { Session, SiloLibrary } from "../types";
