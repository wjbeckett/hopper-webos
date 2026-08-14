import { useCallback, useEffect, useState } from "react";
import { TopNav, type AppSection } from "./components/TopNav";
import { getCatalogItem, getLibraries, getProfileAppearance, restoreDefaultProfile } from "./api/silo";
import { serverRegistry } from "./core/serverRegistry";
import { installSpatialNavigation } from "./navigation/spatial";
import { DetailsScreen } from "./screens/DetailsScreen";
import { DeviceLoginScreen } from "./screens/DeviceLoginScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { PlayerScreen } from "./screens/PlayerScreen";
import { PersonalScreen } from "./screens/PersonalScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SeriesScreen } from "./screens/SeriesScreen";
import { ServerSetupScreen } from "./screens/ServerSetupScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type { Session, SiloItem, SiloLibrary } from "./types";

type AuthRoute = "server-setup" | "device-login" | "password-login";
type DetailRoute =
  | { name: "main" }
  | { name: "details"; item: SiloItem }
  | { name: "series"; item: SiloItem; selectedEpisode?: SiloItem }
  | { name: "play-choice"; item: SiloItem; returnTo?: { series: SiloItem; selectedEpisode: SiloItem } }
  | { name: "player"; item: SiloItem; startPosition?: number; returnTo?: { series: SiloItem; selectedEpisode: SiloItem } };

const DEV_SERVER_URL = "/__silo";
const NAVIGATION_KEY = "silo-webos-navigation-v1";

type SavedNavigation = { serverUrl: string; profileId: string; section: AppSection; route: DetailRoute };

function safeBrowsingRoute(route: DetailRoute): DetailRoute {
  if (route.name === "player" || route.name === "play-choice") {
    return route.returnTo
      ? { name: "series", item: route.returnTo.series, selectedEpisode: route.returnTo.selectedEpisode }
      : { name: "details", item: route.item };
  }
  return route;
}

const THEME_TOKENS: Record<string, Record<string, string>> = {
  "midnight-cinema": { "--background": "#141417", "--foreground": "#e8e8ec", "--primary": "#e8e8ec", "--primary-foreground": "#141417", "--secondary": "#232328", "--surface": "#1c1c20", "--ring": "#e8e8ec", "--muted-foreground": "#9696a0", "--font-body": "Outfit, system-ui, sans-serif", "--font-display": "Outfit, system-ui, sans-serif" },
  "cinema-light": { "--background": "#f4f4f6", "--foreground": "#1a1a1e", "--primary": "#1a1a1e", "--primary-foreground": "#f4f4f6", "--secondary": "#e8e8ec", "--surface": "#ffffff", "--ring": "#1a1a1e", "--muted-foreground": "#63636b", "--font-body": "Outfit, system-ui, sans-serif", "--font-display": "Outfit, system-ui, sans-serif" },
  "cobalt-studio": { "--background": "#101722", "--foreground": "#f4f8ff", "--primary": "#78aefc", "--primary-foreground": "#0f1722", "--secondary": "#1b2634", "--surface": "#151e2b", "--ring": "#78aefc", "--muted-foreground": "#90a0b5", "--font-body": "Outfit, system-ui, sans-serif", "--font-display": "Outfit, system-ui, sans-serif" },
  "oxblood-noir": { "--background": "#171113", "--foreground": "#f7edef", "--primary": "#d16a78", "--primary-foreground": "#1b0e11", "--secondary": "#2b1b1f", "--surface": "#211619", "--ring": "#d16a78", "--muted-foreground": "#ad9298", "--font-body": "Outfit, system-ui, sans-serif", "--font-display": "Outfit, system-ui, sans-serif" },
  "evergreen-studio": { "--background": "#101715", "--foreground": "#eff8f4", "--primary": "#5bc39d", "--primary-foreground": "#09130f", "--secondary": "#192823", "--surface": "#15211d", "--ring": "#5bc39d", "--muted-foreground": "#8fa89f", "--font-body": "Outfit, system-ui, sans-serif", "--font-display": "Outfit, system-ui, sans-serif" }
};

function effectiveServerUrl(url: string) {
  return import.meta.env.DEV ? DEV_SERVER_URL : url;
}

function librariesForSection(section: AppSection, libraries: SiloLibrary[]) {
  return libraries.filter((library) => {
    const type = library.type.replace(/[\s_-]/g, "").toLowerCase();
    if (section === "movies") return ["movie", "movies", "mixed"].includes(type);
    if (section === "series") return ["series", "show", "shows", "tv", "mixed"].includes(type);
    if (section === "music") return ["music", "audio"].includes(type);
    if (section === "audiobooks") return ["audiobook", "audiobooks"].includes(type);
    return false;
  });
}

function sectionTitle(section: AppSection) {
  const titles: Partial<Record<AppSection, string>> = {
    library: "Library",
    movies: "Movies",
    series: "Series",
    music: "Music",
    audiobooks: "Audiobooks"
  };
  return titles[section] ?? "Library";
}

function initialState() {
  const active = serverRegistry.active();
  const activeUrl = effectiveServerUrl(active?.url ?? "");
  if (active?.session) {
    const session = import.meta.env.DEV
      ? { ...active.session, serverUrl: DEV_SERVER_URL }
      : active.session;
    return { session, serverUrl: activeUrl, auth: "device-login" as AuthRoute };
  }
  if (active) return { session: null, serverUrl: activeUrl, auth: "device-login" as AuthRoute };
  if (import.meta.env.DEV) {
    return { session: null, serverUrl: DEV_SERVER_URL, auth: "device-login" as AuthRoute };
  }
  return { session: null, serverUrl: "", auth: "server-setup" as AuthRoute };
}

export default function App() {
  const initial = initialState();
  const [session, setSession] = useState<Session | null>(initial.session);
  const [serverUrl, setServerUrl] = useState(initial.serverUrl);
  const [authRoute, setAuthRoute] = useState<AuthRoute>(initial.auth);
  const [section, setSection] = useState<AppSection>("home");
  const [libraries, setLibraries] = useState<SiloLibrary[]>([]);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [route, setRoute] = useState<DetailRoute>({ name: "main" });
  const [navigationRestored, setNavigationRestored] = useState(false);

  useEffect(() => installSpatialNavigation(), [route.name, authRoute, section, session]);

  useEffect(() => {
    if (!session || profileHydrated) return;
    let alive = true;
    setProfileError("");
    restoreDefaultProfile(session)
      .then((profileSession) => {
        if (!alive) return;
        serverRegistry.saveSession(profileSession);
        setSession(profileSession);
        setProfileHydrated(true);
      })
      .catch((error) => {
        if (alive) setProfileError(error instanceof Error ? error.message : "Could not select profile.");
      });
    return () => { alive = false; };
  }, [session, profileHydrated]);

  useEffect(() => {
    if (!session || !session.profileId) {
      setLibraries([]);
      setLibrariesLoaded(false);
      return;
    }
    let alive = true;
    getLibraries(session)
      .then((next) => {
        if (!alive) return;
        setLibraries(next);
        setLibrariesLoaded(true);
        if (!["home", "search", "settings", "favorites", "watchlist"].includes(section)) {
          const matches = librariesForSection(section, next);
          if (matches.length === 0) setSection("home");
        }
      })
      .catch((error) => { console.error("[Silo webOS] libraries", error); if (alive) setLibrariesLoaded(true); });
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (!session?.profileId || !profileHydrated || !librariesLoaded || navigationRestored) return;
    let alive = true;
    const restore = async () => {
      let saved: SavedNavigation | null = null;
      try { saved = JSON.parse(localStorage.getItem(NAVIGATION_KEY) ?? "null") as SavedNavigation | null; }
      catch { localStorage.removeItem(NAVIGATION_KEY); }
      if (!saved || saved.serverUrl !== session.serverUrl || saved.profileId !== session.profileId) return;

      const allowedSection = ["home", "library", "search", "settings", "favorites", "watchlist"].includes(saved.section)
        || librariesForSection(saved.section, libraries).length > 0;
      if (!allowedSection) return;

      const savedRoute = safeBrowsingRoute(saved.route);
      if (savedRoute.name === "main") {
        if (alive) setSection(saved.section);
        return;
      }
      try {
        if (savedRoute.name === "series") {
          const restoredSeries = await getCatalogItem(session, savedRoute.item.Id);
          let restoredEpisode: SiloItem | undefined;
          if (savedRoute.selectedEpisode) {
            try { restoredEpisode = await getCatalogItem(session, savedRoute.selectedEpisode.Id); }
            catch { restoredEpisode = undefined; }
          }
          if (alive) { setSection(saved.section); setRoute({ name: "series", item: restoredSeries, selectedEpisode: restoredEpisode }); }
        } else if (savedRoute.name === "details") {
          const restoredItem = await getCatalogItem(session, savedRoute.item.Id);
          if (alive) { setSection(saved.section); setRoute({ name: "details", item: restoredItem }); }
        }
      } catch {
        if (alive) { setSection("home"); setRoute({ name: "main" }); localStorage.removeItem(NAVIGATION_KEY); }
      }
    };
    void restore().finally(() => { if (alive) setNavigationRestored(true); });
    return () => { alive = false; };
  }, [libraries, librariesLoaded, navigationRestored, profileHydrated, session]);

  useEffect(() => {
    if (!session?.profileId || !navigationRestored) return;
    const saved: SavedNavigation = {
      serverUrl: session.serverUrl,
      profileId: session.profileId,
      section,
      route: safeBrowsingRoute(route)
    };
    localStorage.setItem(NAVIGATION_KEY, JSON.stringify(saved));
  }, [navigationRestored, route, section, session?.profileId, session?.serverUrl]);

  useEffect(() => {
    if (!session?.profileId) return;
    let alive = true;
    getProfileAppearance(session).then(appearance => {
      if (!alive) return;
      const root = document.documentElement;
      root.dataset.theme = appearance.theme;
      root.dataset.textScale = appearance.textScale;
      root.dataset.textWeight = appearance.textWeight;
      root.dataset.highContrast = appearance.highContrast ? "true" : "false";
      const merged = { ...(THEME_TOKENS[appearance.theme] ?? THEME_TOKENS["midnight-cinema"]), ...appearance.variables };
      for (const [name, value] of Object.entries(merged)) {
        if (/^--[a-z0-9-]+$/.test(name) && typeof value === "string" && value.length <= 128) root.style.setProperty(name, value);
      }
    }).catch(error => console.warn("[Silo webOS] profile appearance", error));
    return () => { alive = false; };
  }, [session?.profileId]);

  useEffect(() => {
    const onBack = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Backspace" && event.keyCode !== 461) return;
      if (!session) return;
      if (route.name !== "main") {
        setRoute({ name: "main" });
        event.preventDefault();
      } else if (section !== "home") {
        setSection("home");
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onBack);
    return () => window.removeEventListener("keydown", onBack);
  }, [session, route.name, section]);

  const login = useCallback((next: Session) => {
    serverRegistry.saveSession(next);
    setServerUrl(next.serverUrl);
    setSession(next);
    setProfileHydrated(false);
    setNavigationRestored(false);
    setLibrariesLoaded(false);
    setSection("home");
    setRoute({ name: "main" });
  }, []);

  function chooseServer(url: string) {
    const entry = serverRegistry.upsert(effectiveServerUrl(url));
    setServerUrl(entry.url);
    if (entry.session) {
      setSession(entry.session);
      setNavigationRestored(false);
      setLibrariesLoaded(false);
      setSection("home");
      setRoute({ name: "main" });
    } else {
      setAuthRoute("device-login");
    }
  }

  function signOut() {
    if (session) serverRegistry.clearSession(session.serverUrl);
    setSession(null);
    setNavigationRestored(false);
    setRoute({ name: "main" });
    setAuthRoute("device-login");
  }

  function changeServer() {
    setSession(null);
    setNavigationRestored(false);
    setRoute({ name: "main" });
    setAuthRoute("server-setup");
  }

  function openItem(item: SiloItem) {
    if (item.Type === "Series") setRoute({ name: "series", item });
    else if (item.Type === "Episode" && item.SeriesId) {
      setRoute({
        name: "series",
        item: { Id: item.SeriesId, Name: item.SeriesName ?? "Series", Type: "Series" },
        selectedEpisode: item
      });
    }
    else setRoute({ name: "details", item });
  }

  function requestPlayback(item: SiloItem, returnTo?: { series: SiloItem; selectedEpisode: SiloItem }) {
    const position = (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
    if (position >= 30) setRoute({ name: "play-choice", item, returnTo });
    else setRoute({ name: "player", item, startPosition: 0, returnTo });
  }

  if (!session) {
    if (authRoute === "server-setup") return <ServerSetupScreen onContinue={chooseServer} />;
    if (authRoute === "password-login") {
      return (
        <LoginScreen
          serverUrl={serverUrl}
          onLogin={login}
          onDeviceLogin={() => setAuthRoute("device-login")}
          onChangeServer={() => setAuthRoute("server-setup")}
        />
      );
    }
    return (
      <DeviceLoginScreen
        serverUrl={serverUrl}
        onLogin={login}
        onPasswordLogin={() => setAuthRoute("password-login")}
        onChangeServer={() => setAuthRoute("server-setup")}
      />
    );
  }

  if (!session.profileId) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="eyebrow">Silo profile</div>
          <h1>{profileError ? "Profile required" : "Loading your profile…"}</h1>
          {profileError ? <div className="error">{profileError}</div> : null}
        </section>
      </main>
    );
  }

  if (route.name === "player") {
    return (
      <PlayerScreen
        session={session}
        item={route.item}
        startPosition={route.startPosition}
        onBack={() => setRoute(route.returnTo
          ? { name: "series", item: route.returnTo.series, selectedEpisode: route.returnTo.selectedEpisode }
          : { name: "details", item: route.item })}
      />
    );
  }

  if (route.name === "play-choice") {
    const resumeAt = (route.item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
    const minutes = Math.floor(resumeAt / 60);
    const seconds = Math.floor(resumeAt % 60);
    const destination = route.returnTo;
    return <main className="play-choice-shell">
      <button data-tv-focusable="true" className="tv-button secondary top-back" onClick={() => setRoute(destination ? { name: "series", item: destination.series, selectedEpisode: destination.selectedEpisode } : { name: "details", item: route.item })}>‹ Back</button>
      <section className="play-choice-card">
        <div className="eyebrow">Continue watching</div>
        <h1>{route.item.Name}</h1>
        <p>Resume from {minutes}:{String(seconds).padStart(2, "0")}</p>
        <div className="play-choice-actions">
          <button autoFocus data-tv-focusable="true" className="tv-button" onClick={() => setRoute({ name: "player", item: route.item, startPosition: resumeAt, returnTo: destination })}>▶ Resume</button>
          <button data-tv-focusable="true" className="tv-button secondary" onClick={() => setRoute({ name: "player", item: route.item, startPosition: 0, returnTo: destination })}>↻ Play From Start</button>
        </div>
      </section>
    </main>;
  }

  if (route.name === "series") {
    return (
      <SeriesScreen
        session={session}
        series={route.item}
        initialEpisode={route.selectedEpisode}
        onSelectEpisode={(episode) => setRoute({ name: "series", item: route.item, selectedEpisode: episode })}
        onOpenEpisode={(episode) => requestPlayback(episode, { series: route.item, selectedEpisode: episode })}
        onBack={() => setRoute({ name: "main" })}
      />
    );
  }

  if (route.name === "details") {
    return (
      <DetailsScreen
        session={session}
        item={route.item}
        onPlay={() => requestPlayback(route.item)}
        onBack={() => setRoute({ name: "main" })}
      />
    );
  }

  let body;
  if (section === "home") body = <HomeScreen session={session} onOpen={openItem} />;
  else if (section === "search") body = <SearchScreen session={session} onOpen={openItem} />;
  else if (section === "favorites" || section === "watchlist") {
    body = <PersonalScreen session={session} kind={section} onOpen={openItem} />;
  }
  else if (section === "settings") {
    body = <SettingsScreen session={session} onSignOut={signOut} onChangeServer={changeServer} />;
  } else if (section === "library") {
    body = <LibraryScreen session={session} title="All Libraries" libraries={libraries} selectableLibraries onOpen={openItem} />;
  } else {
    const matchingLibraries = librariesForSection(section, libraries);
    body = matchingLibraries.length ? (
      <LibraryScreen
        session={session}
        title={sectionTitle(section)}
        libraries={matchingLibraries}
        itemTypes={section === "movies" ? ["Movie"] : section === "series" ? ["Series"] : undefined}
        onOpen={openItem}
      />
    ) : <div className="screen-state">Loading library…</div>;
  }

  const librarySections = (["movies", "series", "music", "audiobooks"] as AppSection[])
    .filter((candidate) => librariesForSection(candidate, libraries).length > 0)
    .map((candidate) => ({ id: candidate, label: sectionTitle(candidate) }));
  const navSections = [
    { id: "home" as const, label: "Home" },
    { id: "library" as const, label: "Library" },
    ...librarySections,
    { id: "watchlist" as const, label: "Watchlist" },
    { id: "favorites" as const, label: "Favorites" },
    { id: "search" as const, label: "Search" }
  ];

  return (
    <div className="app-shell">
      <TopNav
        active={section}
        sections={navSections}
        username={session.username}
        session={session}
        onSelect={(next) => { setSection(next); setRoute({ name: "main" }); }}
        onProfile={() => setSection("settings")}
        onFavorites={() => { setSection("favorites"); setRoute({ name: "main" }); }}
        onWatchlist={() => { setSection("watchlist"); setRoute({ name: "main" }); }}
      />
      {body}
    </div>
  );
}
