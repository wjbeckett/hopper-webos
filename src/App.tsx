import { useCallback, useEffect, useState } from "react";
import { TopNav, type AppSection, type LibraryLanding } from "./components/TopNav";
import { advanceShuffle, createShuffle, deleteShuffle, getCatalogItem, getLibraries, getProfileAppearance, getRequestsFeatureStatus, restoreDefaultProfile } from "./api/silo";
import { serverRegistry } from "./core/serverRegistry";
import { focusTopNavigation, installSpatialNavigation } from "./navigation/spatial";
import { DetailsScreen } from "./screens/DetailsScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { CollectionsScreen } from "./screens/CollectionsScreen";
import { DeviceLoginScreen } from "./screens/DeviceLoginScreen";
import { ForYouScreen } from "./screens/ForYouScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { AudiobookGroupsScreen, groupSubtitle } from "./screens/AudiobookGroupsScreen";
import type { GroupKind } from "./screens/AudiobookGroupsScreen";
import { LibraryCollectionsScreen } from "./screens/LibraryCollectionsScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { LibraryRecommendationsScreen } from "./screens/LibraryRecommendationsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { PersonScreen } from "./screens/PersonScreen";
import { PlayerScreen } from "./screens/PlayerScreen";
import { PersonalScreen } from "./screens/PersonalScreen";
import { ProfileSelectionScreen } from "./screens/ProfileSelectionScreen";
import { RequestsScreen } from "./screens/RequestsScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SeriesScreen } from "./screens/SeriesScreen";
import { ServerSetupScreen } from "./screens/ServerSetupScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type { AudiobookGroup } from "./api/silo";
import type { PlaybackChoices } from "./api/playback";
import { applyResumeState, applyWatchedState, publishWatchState } from "./core/watchState";
import { publishRailsChanged } from "./core/watchState";
import { connectEventsSocket } from "./api/events";
import type { Session, SiloCollection, SiloItem, SiloLibrary, SiloProfile } from "./types";
import { LoadingState } from "./components/LoadingState";

type AuthRoute = "server-setup" | "device-login" | "password-login";
type DetailRoute =
  | { name: "main" }
  | { name: "details"; item: SiloItem; castIndex?: number }
  | { name: "series"; item: SiloItem; selectedEpisode?: SiloItem; castIndex?: number }
  | { name: "person"; personId?: string; personName: string; back: DetailRoute }
  | { name: "play-choice"; item: SiloItem; returnTo?: { series: SiloItem; selectedEpisode: SiloItem } }
  | { name: "player"; item: SiloItem; startPosition?: number; choices?: PlaybackChoices; returnTo?: { series: SiloItem; selectedEpisode: SiloItem }; shuffleId?: string };

type BrowseDetail =
  | { kind: "collection"; library: SiloLibrary; collection: SiloCollection }
  | { kind: "group"; library: SiloLibrary; groupKind: GroupKind; group: AudiobookGroup };

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
  "midnight-cinema": { "--background": "#070809", "--foreground": "#f4f4f2", "--primary": "#f4f4f2", "--primary-foreground": "#08090a", "--secondary": "#1b1c1e", "--surface": "#101113", "--ring": "#f4f4f2", "--muted-foreground": "#929398", "--font-body": "Outfit, system-ui, sans-serif", "--font-display": "Outfit, system-ui, sans-serif" },
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
  const [selectedSeriesLibraryId, setSelectedSeriesLibraryId] = useState<number | null>(null);
  const [libraryLanding, setLibraryLanding] = useState<LibraryLanding>("recommended");
  const [browseDetail, setBrowseDetail] = useState<BrowseDetail | null>(null);
  const [libraries, setLibraries] = useState<SiloLibrary[]>([]);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const [requestsAvailable, setRequestsAvailable] = useState<boolean | undefined>();
  const [profileError, setProfileError] = useState("");
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [route, setRoute] = useState<DetailRoute>({ name: "main" });
  const [navigationRestored, setNavigationRestored] = useState(false);

  useEffect(() => installSpatialNavigation(), [route.name, authRoute, session]);

  useEffect(() => {
    if (!session) return;
    return connectEventsSocket(session, publishRailsChanged);
  }, [session]);

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
      setRequestsAvailable(undefined);
      return;
    }
    let alive = true;
    getLibraries(session)
      .then((next) => {
        if (!alive) return;
        setLibraries(next);
        setLibrariesLoaded(true);
        if (!["home", "forYou", "calendar", "requests", "search", "settings", "favorites", "watchlist", "history", "collections", "profiles"].includes(section)) {
          const matches = librariesForSection(section, next);
          if (matches.length === 0) setSection("home");
        }
      })
      .catch((error) => { console.error("[Silo webOS] libraries", error); if (alive) setLibrariesLoaded(true); });
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (!session?.profileId) return;
    let alive = true;
    setRequestsAvailable(undefined);
    getRequestsFeatureStatus(session)
      .then(status => {
        if (alive) setRequestsAvailable(
          status.requests_enabled && status.allowed === true && status.state === "available"
        );
      })
      .catch(error => {
        console.warn("[Silo webOS] request availability", error);
        if (alive) setRequestsAvailable(undefined);
      });
    return () => { alive = false; };
  }, [session?.serverUrl, session?.profileId, session?.accessToken]);

  useEffect(() => {
    if (!session?.profileId || !profileHydrated || !librariesLoaded || navigationRestored) return;
    let alive = true;
    const restore = async () => {
      let saved: SavedNavigation | null = null;
      try { saved = JSON.parse(localStorage.getItem(NAVIGATION_KEY) ?? "null") as SavedNavigation | null; }
      catch { localStorage.removeItem(NAVIGATION_KEY); }
      if (!saved || saved.serverUrl !== session.serverUrl || saved.profileId !== session.profileId) return;

      const allowedSection = ["home", "forYou", "calendar", "requests", "library", "search", "settings", "favorites", "watchlist"].includes(saved.section)
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
      if (!["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) && event.keyCode !== 461 && event.keyCode !== 10009) return;
      if (!session) return;
      if (document.querySelector(".player-shell")) return;
      if (document.querySelector(".browse-panel-scrim")) {
        window.dispatchEvent(new Event("silo:browse-panel-back"));
        event.preventDefault();
        return;
      }
      const nav = document.querySelector<HTMLElement>(".tv-nav");
      if (nav) {
        const activeElement = document.activeElement;
        const openCallout = nav.querySelector(".nav-callout");
        const activeNav = nav.querySelector<HTMLElement>("[data-nav-primary][aria-current='page']")
          ?? nav.querySelector<HTMLElement>("[data-nav-primary]");
        if (openCallout) {
          const entry = activeElement instanceof HTMLElement
            ? activeElement.closest<HTMLElement>(".nav-entry")
            : null;
          const parent = entry?.querySelector<HTMLElement>("[data-nav-primary]");
          focusTopNavigation(parent ?? activeNav);
          window.dispatchEvent(new Event("silo:close-nav-callout"));
          event.preventDefault();
          return;
        }
        if (route.name === "main" && browseDetail && !(activeElement instanceof HTMLElement && activeElement.closest(".tv-nav"))) {
          setBrowseDetail(null);
          event.preventDefault();
          return;
        }
        if (route.name === "person") {
          setRoute(route.back);
          event.preventDefault();
          return;
        }
        if (route.name !== "main") {
          setRoute({ name: "main" });
          focusTopNavigation(activeNav);
          event.preventDefault();
          return;
        }
        if (section !== "home") {
          setSection("home");
          focusTopNavigation(nav.querySelector<HTMLElement>("[data-nav-primary='home']"));
          event.preventDefault();
          return;
        }
        if (activeNav) focusTopNavigation(activeNav);
        event.preventDefault();
        return;
      }
      if (route.name === "person") {
        setRoute(route.back);
        event.preventDefault();
      } else if (route.name === "play-choice") {
        setRoute(route.returnTo ? { name: "series", item: route.returnTo.series, selectedEpisode: route.returnTo.selectedEpisode } : { name: "details", item: route.item });
        event.preventDefault();
      } else if (route.name !== "main") {
        setRoute({ name: "main" });
        event.preventDefault();
      } else if (section !== "home") {
        setSection("home");
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onBack);
    return () => window.removeEventListener("keydown", onBack);
  }, [session, route.name, section, browseDetail]);

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

  function openItem(item: SiloItem, options?: { episode?: SiloItem }) {
    if (item.Type === "Series") setRoute({ name: "series", item, selectedEpisode: options?.episode });
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

  function playExtra(trailer: { contentId?: string; title: string }) {
    if (!trailer.contentId) return;
    setRoute({ name: "player", item: { Id: trailer.contentId, Name: trailer.title, Type: "Extra" }, startPosition: 0 });
  }

  async function startShuffle(kind: string, id: string | number) {
    if (!session) throw new Error("A connected server session is required to shuffle.");
    const shuffle = await createShuffle(session, kind, id);
    setRoute({ name: "player", item: shuffle.current, startPosition: 0, shuffleId: shuffle.id });
  }

  async function advanceShuffleRoute(shuffleId: string, finished: SiloItem) {
    if (!session) return;
    try {
      const shuffle = await advanceShuffle(session, shuffleId, finished.Id);
      if (shuffle.current.Id === finished.Id) throw new Error("Nothing else can play.");
      setRoute({ name: "player", item: shuffle.current, startPosition: 0, shuffleId });
    } catch {
      void deleteShuffle(session, shuffleId).catch(() => undefined);
      setRoute({ name: "main" });
    }
  }

  function leavePlayer(current: Extract<DetailRoute, { name: "player" }>) {
    if (current.shuffleId) {
      if (session) void deleteShuffle(session, current.shuffleId).catch(() => undefined);
      setRoute({ name: "main" });
      return;
    }
    setRoute(current.returnTo
      ? { name: "series", item: current.returnTo.series, selectedEpisode: current.returnTo.selectedEpisode }
      : { name: "details", item: current.item });
  }

  function activateProfile(profile: SiloProfile, profileToken?: string) {
    if (!session) return;
    const nextSession: Session = {
      ...session,
      profileId: profile.id,
      profileToken,
      profileAvatar: profile.avatarUrl ?? profile.avatarEmoji,
      profileMetadataLoaded: true,
      username: profile.name
    };
    serverRegistry.saveSession(nextSession);
    setSession(nextSession);
    setProfileError("");
    setProfileHydrated(true);
    setLibrariesLoaded(false);
    setRequestsAvailable(undefined);
    setSection("home");
    setRoute({ name: "main" });
    setNavigationRestored(true);
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

  if (profileError) {
    return <ProfileSelectionScreen session={session} onSelect={activateProfile} />;
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
        key={route.item.Id}
        session={session}
        item={route.item}
        startPosition={route.startPosition}
        choices={route.choices}
        onBack={(elapsed) => {
          publishWatchState(applyResumeState(route.item, elapsed));
          leavePlayer(route);
        }}
        onEnded={route.shuffleId ? () => void advanceShuffleRoute(route.shuffleId!, route.item) : () => {
          publishWatchState(applyWatchedState(route.item, true));
          leavePlayer(route);
        }}
      />
    );
  }

  if (route.name === "play-choice") {
    const resumeAt = (route.item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
    const minutes = Math.floor(resumeAt / 60);
    const seconds = Math.floor(resumeAt % 60);
    const destination = route.returnTo;
    return <main className="play-choice-shell">
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

  if (route.name === "person") {
    return (
      <PersonScreen
        session={session}
        personId={route.personId}
        name={route.personName}
        onOpen={openItem}
        onBack={() => setRoute(route.back)}
      />
    );
  }

  if (route.name === "series") {
    return (
      <SeriesScreen
        key={route.item.Id}
        session={session}
        series={route.item}
        initialEpisode={route.selectedEpisode}
        restoreCastIndex={route.castIndex}
        onOpenPerson={(person, index) => setRoute({ name: "person", personId: person.personId, personName: person.name, back: { ...route, castIndex: index } })}
        onPlayExtra={playExtra}
        onPlayEpisode={(episode, startPosition, choices) => setRoute({ name: "player", item: episode, startPosition, choices, returnTo: { series: route.item, selectedEpisode: episode } })}
        onShuffle={startShuffle}
        onOpen={openItem}
        onBack={() => setRoute({ name: "main" })}
      />
    );
  }

  if (route.name === "details") {
    return (
      <DetailsScreen
        session={session}
        item={route.item}
        restoreCastIndex={route.castIndex}
        onOpenPerson={(person, index) => setRoute({ name: "person", personId: person.personId, personName: person.name, back: { ...route, castIndex: index } })}
        onPlayExtra={playExtra}
        onPlay={(startPosition, choices) => setRoute({ name: "player", item: route.item, startPosition, choices })}
        onOpen={openItem}
        onBack={() => setRoute({ name: "main" })}
      />
    );
  }

  let body;
  if (section === "home") body = <HomeScreen session={session} onOpen={openItem} />;
  else if (section === "forYou") body = <ForYouScreen session={session} onOpen={openItem} />;
  else if (section === "search") body = <SearchScreen session={session} onOpen={openItem} />;
  else if (section === "favorites" || section === "watchlist") {
    body = <PersonalScreen session={session} kind={section} onOpen={openItem} />;
  }
  else if (section === "history") body = <HistoryScreen session={session} onOpen={openItem} />;
  else if (section === "collections") body = <CollectionsScreen session={session} onOpen={openItem} />;
  else if (section === "profiles") body = <ProfileSelectionScreen session={session} onSelect={activateProfile} />;
  else if (section === "settings") {
    body = <SettingsScreen session={session} onSignOut={signOut} onChangeServer={changeServer} />;
  } else if (section === "library") {
    body = <LibraryScreen key="all" session={session} libraries={libraries} selectableLibraries onOpen={openItem} onShuffle={startShuffle} />;
  }   else if (section === "calendar") body = <CalendarScreen session={session} onOpen={openItem} />;
  else if (section === "requests") body = <RequestsScreen session={session} />; else {
    const sectionLibraries = librariesForSection(section, libraries);
    const defaultSeriesLibraryId = sectionLibraries.some(library => library.id === selectedSeriesLibraryId)
      ? selectedSeriesLibraryId
      : sectionLibraries[0]?.id;
    const matchingLibraries = section === "series" && defaultSeriesLibraryId !== undefined
      ? sectionLibraries.filter(library => library.id === defaultSeriesLibraryId)
      : sectionLibraries;
    if (!matchingLibraries.length) {
      body = <LoadingState label="Loading library" />;
    } else if (libraryLanding === "collections") {
      const mixedTypes = section === "movies" ? ["Movie"] : section === "series" ? ["Series"] : undefined;
      body = browseDetail?.kind === "collection" ? (
        <LibraryScreen
          key={`collection-${browseDetail.collection.id}`}
          session={session}
          libraries={[browseDetail.library]}
          itemTypes={browseDetail.library.type.trim().toLowerCase() === "mixed" ? mixedTypes : undefined}
          onOpen={openItem}
          onShuffle={startShuffle}
          collection={{ id: browseDetail.collection.id, name: browseDetail.collection.name, source: browseDetail.collection.kind === "user_collection" ? "user_collection" : "library_collection" }}
          header={<div className="library-header-row"><h1 className="library-header-title">{browseDetail.collection.name}</h1></div>}
        />
      ) : (
        <LibraryCollectionsScreen
          session={session}
          libraries={matchingLibraries}
          scopeKey={`${session.serverUrl}|${session.profileId ?? ""}|${section}|${matchingLibraries.map(library => library.id).join(",")}`}
          onOpen={({ library, collection }) => setBrowseDetail({ kind: "collection", library, collection })}
        />
      );
    } else if (section === "audiobooks" && (libraryLanding === "authors" || libraryLanding === "series")) {
      const groupKind: GroupKind = libraryLanding === "authors" ? "author" : "series";
      const library = matchingLibraries[0];
      body = browseDetail?.kind === "group" && browseDetail.groupKind === groupKind ? (
        <LibraryScreen
          key={`group-${groupKind}-${browseDetail.group.name}`}
          session={session}
          libraries={[browseDetail.library]}
          onOpen={openItem}
          onShuffle={startShuffle}
          presetGroups={[{ match: "all", rules: [{ field: groupKind, op: "is", value: browseDetail.group.name }] }]}
          presetKey={`${groupKind}:${browseDetail.group.name}`}
          header={
            <div className="library-header-row">
              <button type="button" data-tv-focusable="true" className="browse-dropdown-trigger" onClick={() => setBrowseDetail(null)}>
                <span>{groupKind === "author" ? "All Authors" : "All Series"}</span>
              </button>
              <h1 className="library-header-title">{browseDetail.group.name}</h1>
              <span className="library-header-subtitle">{groupSubtitle(browseDetail.group)}</span>
            </div>
          }
        />
      ) : (
        <AudiobookGroupsScreen
          session={session}
          library={library}
          kind={groupKind}
          onOpen={group => setBrowseDetail({ kind: "group", library, groupKind, group })}
        />
      );
    } else if (libraryLanding === "recommended") {
      body = (
        <LibraryRecommendationsScreen
          session={session}
          title={section === "series" ? matchingLibraries[0].name : sectionTitle(section)}
          libraries={matchingLibraries}
          onOpen={openItem}
        />
      );
    } else {
      body = (
        <LibraryScreen
          key={`${section}-${libraryLanding}-${matchingLibraries.map(library => library.id).join(",")}`}
          session={session}
          libraries={matchingLibraries}
          itemTypes={section === "movies" ? ["Movie"] : section === "series" ? ["Series"] : undefined}
          onOpen={openItem}
          onShuffle={startShuffle}
          presetKey={libraryLanding === "alphabet" ? "alphabet" : undefined}
          hideControls={libraryLanding === "alphabet"}
        />
      );
    }
  }

  return (
    <div className={`app-shell ${section === "library" || (["movies", "series", "music", "audiobooks"].includes(section) && (libraryLanding === "browse" || libraryLanding === "alphabet" || browseDetail !== null)) ? "app-shell-library" : ""} ${section === "home" && route.name === "main" ? "app-shell-home" : ""}`}>
      <TopNav
        active={section}
        libraries={libraries}
        requestsAvailable={requestsAvailable}
        username={session.username}
        session={session}
        onSelect={(next, libraryId, landing = "recommended") => {
          if (next === "series") {
            const firstSeriesLibrary = librariesForSection("series", libraries)[0];
            setSelectedSeriesLibraryId(libraryId ?? firstSeriesLibrary?.id ?? null);
          }
          setLibraryLanding(landing);
          setBrowseDetail(null);
          setSection(next);
          setRoute({ name: "main" });
        }}
        onProfile={() => setSection("settings")}
        onFavorites={() => { setSection("favorites"); setRoute({ name: "main" }); }}
        onWatchlist={() => { setSection("watchlist"); setRoute({ name: "main" }); }}
        onLibraries={() => { setSection("library"); setRoute({ name: "main" }); }}
        onHistory={() => { setSection("history"); setRoute({ name: "main" }); }}
        onProfiles={() => { setSection("profiles"); setRoute({ name: "main" }); }}
      />
      {body}
    </div>
  );
}
