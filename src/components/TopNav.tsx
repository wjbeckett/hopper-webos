export type AppSection = "home" | "forYou" | "calendar" | "requests" | "library" | "collections" | "movies" | "series" | "music" | "audiobooks" | "search" | "favorites" | "watchlist" | "history" | "profiles" | "settings";
export type LibraryLanding = "recommended" | "browse";

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
  onProfiles
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
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<PrimaryNavId | null>(null);
  const [openSeriesLibrary, setOpenSeriesLibrary] = useState<number | null>(null);
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
    const closeMenu = () => {
      setOpenMenu(null);
      setOpenSeriesLibrary(null);
    };
    window.addEventListener("silo:close-nav-callout", closeMenu);
    return () => window.removeEventListener("silo:close-nav-callout", closeMenu);
  }, []);

  function showMenu(id: PrimaryNavId) {
    setOpenMenu(["movies", "series", "forYou"].includes(id) ? id : null);
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
        }
      }}
    >
      <div className="brand-mark" role="img" aria-label="Silo">
        <img src="/silo-wordmark-white.svg" alt="" />
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
                aria-haspopup={["movies", "series", "forYou"].includes(item.id) ? "menu" : undefined}
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
                    <CalloutButton icon="collections" onClick={() => selectSection("collections")}>Collections</CalloutButton>
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
                              <CalloutButton icon="collections" onClick={() => selectSection("collections")}>Collections</CalloutButton>
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
          <div className="profile-menu">
            <div className="profile-menu-name">{username}</div>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onWatchlist(); }}>▣ Watchlist</button>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onFavorites(); }}>♥ Favorites</button>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onHistory(); }}>◷ History</button>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onProfiles(); }}>⇄ Switch Profile</button>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onLibraries(); }}>▦ Libraries</button>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onSelect("collections"); }}>▤ Collections</button>
            <button data-tv-focusable="true" onClick={() => { setProfileOpen(false); onProfile(); }}>⚙ Settings</button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function CalloutButton({
  children,
  icon,
  onClick
}: {
  children: string;
  icon: "sparkles" | "grid" | "collections" | "heart" | "bookmark";
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
import type { Session, SiloLibrary } from "../types";
