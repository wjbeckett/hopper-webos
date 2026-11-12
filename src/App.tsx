import { getEffectiveSettings } from "./api/settings";
import { hydrateTitleArt } from "./core/titleArt";
import { setThemeMusicPreferences, setThemeMusicSession } from "./core/themeMusic";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TopNav, type AppSection, type LibraryLanding } from "./components/TopNav";
import { advanceShuffle, createShuffle, deleteShuffle, getCatalogItem, getEpisodes, getLibraries, getProfileAppearance, getRequestsFeatureStatus, getSeasons, getSetupStatus, restoreDefaultProfile } from "./api/silo";
import { serverRegistry } from "./core/serverRegistry";
import { focusTopNavigation, installSpatialNavigation } from "./navigation/spatial";
import { installPointerNavigation } from "./navigation/pointer";
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
import { clearBackgrounded, markBackgrounded, requiresSelectionAfterBackground, requiresSelectionAtLaunch } from "./core/profileLaunch";
import { ProfileSelectionScreen } from "./screens/ProfileSelectionScreen";
import { RequestsScreen } from "./screens/RequestsScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SeriesScreen } from "./screens/SeriesScreen";
import { SignupScreen } from "./screens/SignupScreen";
import { PhoneSetupScreen } from "./screens/PhoneSetupScreen";
import { ServerSetupScreen } from "./screens/ServerSetupScreen";
import { pairingAvailable } from "./platform/pairing";
import { platformBack } from "./platform/back";
import { installKeyboardTracking, virtualKeyboardVisible } from "./platform/keyboard";
import { FirstRunSetupScreen } from "./screens/FirstRunSetupScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SectionBrowseScreen, type SectionBrowseArgs } from "./screens/SectionBrowseScreen";
import type { AudiobookGroup } from "./api/silo";
import type { PlaybackChoices } from "./api/playback";
import { applyResumeState, applyWatchedState, publishWatchState } from "./core/watchState";
import { firstEpisodeOfSeason, nextEpisodeAfter } from "./core/episodeNavigation";
import { publishRailsChanged } from "./core/watchState";
import { connectEventsSocket } from "./api/events";
import { subscribeReload, subscribeSessionExpired, watchServer } from "./api/connection";
import { ConnectionLost } from "./components/ConnectionLost";
import type { HomeRail, Session, SiloCollection, SiloItem, SiloLibrary, SiloProfile } from "./types";
import { LoadingState } from "./components/LoadingState";

import { installClientLogCapture } from "./core/clientLogs";

installClientLogCapture();

type AuthRoute = "phone-setup" | "server-setup" | "first-run-setup" | "device-login" | "password-login" | "signup";
type DetailRoute =
  | { name: "main" }
  | { name: "details"; item: SiloItem; castIndex?: number }
  | { name: "series"; item: SiloItem; selectedEpisode?: SiloItem; castIndex?: number }
  | { name: "person"; personId?: string; personName: string; back: DetailRoute }
  | { name: "player"; item: SiloItem; startPosition?: number; autoAdvanceCount?: number; choices?: PlaybackChoices; returnTo?: { series: SiloItem; selectedEpisode: SiloItem }; shuffleId?: string; shuffleNext?: SiloItem; shuffleScope?: string };

type BrowseDetail =
  | { kind: "collection"; library: SiloLibrary; collection: SiloCollection }
  | { kind: "group"; library: SiloLibrary; groupKind: GroupKind; group: AudiobookGroup };

const DEV_SERVER_URL = "/__silo";
const NAVIGATION_KEY = "silo-webos-navigation-v1";

type SavedNavigation = { serverUrl: string; profileId: string; section: AppSection; route: DetailRoute };

function safeBrowsingRoute(route: DetailRoute): DetailRoute {
  if (route.name === "player") {
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

/**
 * The first screen when nobody is signed in. On a TV that is phone setup, whether or not a
 * server is saved: the phone finds the TV and signs it in, with nothing to type. Its button
 * leads to code sign-in. A browser has no pairing service and starts at code sign-in.
 */
function signedOutEntry(): AuthRoute {
  return pairingAvailable() ? "phone-setup" : "device-login";
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
  if (active) return { session: null, serverUrl: activeUrl, auth: signedOutEntry() };
  if (import.meta.env.DEV) {
    return { session: null, serverUrl: DEV_SERVER_URL, auth: "device-login" as AuthRoute };
  }
  // No server yet: lead with phone pairing (Android's phone-first setup), but
  // only where the pairing service exists. Browsers keep manual entry.
  return { session: null, serverUrl: "", auth: (pairingAvailable() ? "phone-setup" : "server-setup") as AuthRoute };
}

let launchSelectionRequired = requiresSelectionAtLaunch();

export default function App() {
  const initial = initialState();
  const [session, setSession] = useState<Session | null>(initial.session);
  const [serverUrl, setServerUrl] = useState(initial.serverUrl);
  const [authRoute, setAuthRoute] = useState<AuthRoute>(initial.auth);
  const [section, setSection] = useState<AppSection>("home");
  const [selectedSeriesLibraryId, setSelectedSeriesLibraryId] = useState<number | null>(null);
  const [libraryLanding, setLibraryLanding] = useState<LibraryLanding>("recommended");
  const [browseDetail, setBrowseDetail] = useState<BrowseDetail | null>(null);
  // A row's full page ("Explore all"), shown inside the shell so the top nav stays.
  const [sectionBrowse, setSectionBrowse] = useState<SectionBrowseArgs | null>(null);
  const [libraries, setLibraries] = useState<SiloLibrary[]>([]);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const [requestsAvailable, setRequestsAvailable] = useState<boolean | undefined>();
  const [profileError, setProfileError] = useState("");
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [route, setRoute] = useState<DetailRoute>({ name: "main" });
  const [navigationRestored, setNavigationRestored] = useState(false);
  // Server name to show on the sign-in screen after the server ended the sign-in.
  const [signedOutOf, setSignedOutOf] = useState("");
  // Goes up when the server answers again after a screen failed to load; screens are keyed on it.
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => installSpatialNavigation(), [route.name, authRoute, session]);
  useEffect(() => installPointerNavigation(), []);
  useEffect(() => installKeyboardTracking(), []);

  // A layout effect, so it runs before the screens' own effects send their first requests.
  useLayoutEffect(() => { watchServer(session?.serverUrl ?? ""); }, [session?.serverUrl]);
  useEffect(() => subscribeReload(() => setConnectionEpoch(epoch => epoch + 1)), []);
  // Android TvAppNavigation: when the server refuses the sign-in for good, go back to sign-in
  // for the same server and say why. The saved server stays.
  useEffect(() => subscribeSessionExpired((serverUrl) => {
    const current = sessionRef.current;
    if (!current || current.serverUrl.trim().replace(/\/+$/, "") !== serverUrl) return;
    setSignedOutOf(serverRegistry.active()?.name ?? "the server");
    setSession(null);
    setNavigationRestored(false);
    setRoute({ name: "main" });
    setAuthRoute(signedOutEntry());
  }), []);

  useEffect(() => {
    if (!session) return;
    return connectEventsSocket(session, publishRailsChanged);
  }, [session]);

  useEffect(() => {
    if (!session || profileHydrated) return;
    let alive = true;
    if (launchSelectionRequired) {
      setProfileError("Choose who is watching.");
      return;
    }
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
  }, [session, profileHydrated, connectionEpoch]);

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
      .catch((error) => { console.error("[Hopper] libraries", error); if (alive) setLibrariesLoaded(true); });
    return () => { alive = false; };
  }, [session, connectionEpoch]);

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
        console.warn("[Hopper] request availability", error);
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
    setThemeMusicSession(session ?? null);
    if (!session?.profileId) return;
    let alive = true;
    void hydrateTitleArt(session);
    getEffectiveSettings(session, ["ui.theme_music_enabled", "ui.theme_music_loop"]).then(effective => {
      if (alive) setThemeMusicPreferences(effective.get("ui.theme_music_enabled")?.value === true, effective.get("ui.theme_music_loop")?.value === true);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [session?.profileId, session?.serverUrl]);

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
      root.dataset.posterSize = appearance.posterSize;
      const merged = { ...(THEME_TOKENS[appearance.theme] ?? THEME_TOKENS["midnight-cinema"]), ...appearance.variables };
      for (const [name, value] of Object.entries(merged)) {
        if (/^--[a-z0-9-]+$/.test(name) && typeof value === "string" && value.length <= 128) root.style.setProperty(name, value);
      }
    }).catch(error => console.warn("[Hopper] profile appearance", error));
    return () => { alive = false; };
  }, [session?.profileId]);

  useEffect(() => {
    const onBack = (event: KeyboardEvent) => {
      if (!["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) && event.keyCode !== 461 && event.keyCode !== 10009) return;
      // Backspace inside a text field edits the text; only the remote's Back leaves.
      const editingText = event.key === "Backspace" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement);
      // LG's rule for an app's entry page: Back hands over to the TV (the exit popup or the
      // Home launcher). Once per press, so a held Back can't reopen it.
      const exitApp = () => {
        if (!event.repeat && !editingText && platformBack()) event.preventDefault();
      };
      if (!session) {
        // Server setup without a saved server was opened from phone setup, so Back returns there.
        // With a saved server, ServerSetupScreen handles Back itself.
        if (authRoute === "server-setup" && pairingAvailable() && !serverRegistry.active()) {
          if (!event.repeat && !editingText) {
            setAuthRoute("phone-setup");
            event.preventDefault();
          }
          return;
        }
        // Code sign-in was opened from phone setup (the entry page on a TV), so Back returns there.
        if (authRoute === "device-login" && pairingAvailable()) {
          if (!event.repeat && !editingText) {
            setAuthRoute("phone-setup");
            event.preventDefault();
          }
          return;
        }
        if (authRoute === "phone-setup" || authRoute === "device-login" || authRoute === "server-setup") exitApp();
        if (authRoute === "password-login" || authRoute === "first-run-setup") {
          // While the TV's keyboard is open, Back is the keyboard's: it closes it, and the
          // next press leaves the screen.
          if (virtualKeyboardVisible()) return;
          // Password sign-in was opened from code sign-in, so Back returns there.
          if (authRoute === "password-login") {
            if (!event.repeat && !editingText) {
              setAuthRoute("device-login");
              event.preventDefault();
            }
            return;
          }
          // First-run setup takes the place of code sign-in for a server with no accounts,
          // so it is the entry page. Server setup would reopen the saved server and land here again.
          exitApp();
        }
        return;
      }
      if (document.querySelector(".player-shell")) return;
      // The full-screen profile picker (and the profile loading screen) is the entry page
      // when a profile has to be chosen. Its own dialogs take Back first.
      if (profileError || !session.profileId) {
        exitApp();
        return;
      }
      if (document.querySelector(".profile-menu")) {
        window.dispatchEvent(new Event("silo:close-profile-menu"));
        event.preventDefault();
        return;
      }
      const settingsPane = document.querySelector(".settings-pane");
      if (settingsPane && document.activeElement instanceof HTMLElement && settingsPane.contains(document.activeElement)) {
        document.querySelector<HTMLElement>(".settings-rail [aria-current='true']")?.focus();
        event.preventDefault();
        return;
      }
      if (document.querySelector(".browse-panel-scrim")) {
        window.dispatchEvent(new Event("silo:browse-panel-back"));
        event.preventDefault();
        return;
      }
      if (document.querySelector(".library-results")) {
        const cleared = window.dispatchEvent(new CustomEvent("silo:library-back", { cancelable: true }));
        if (!cleared) {
          event.preventDefault();
          return;
        }
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
        if (route.name === "main" && sectionBrowse && !(activeElement instanceof HTMLElement && activeElement.closest(".tv-nav"))) {
          setSectionBrowse(null);
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
        const homeTab = nav.querySelector<HTMLElement>("[data-nav-primary='home']");
        if (homeTab && activeElement === homeTab) {
          // Home's "Explore all" page is one step deeper than Home.
          if (sectionBrowse) {
            setSectionBrowse(null);
            event.preventDefault();
            return;
          }
          exitApp();
          return;
        }
        if (activeNav) focusTopNavigation(activeNav);
        event.preventDefault();
        return;
      }
      if (route.name === "person") {
        setRoute(route.back);
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
  }, [session, route.name, section, browseDetail, sectionBrowse, authRoute, profileError]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        markBackgrounded();
        return;
      }
      if (requiresSelectionAfterBackground()) {
        clearBackgrounded();
        setProfileError("Choose who is watching.");
        setSection("home");
        setRoute({ name: "main" });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const login = useCallback((next: Session) => {
    launchSelectionRequired = false;
    setSignedOutOf("");
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
      // Android TvServerSetupViewModel: a fresh server (needs_setup) goes to
      // first-run setup instead of sign-in. A failed probe keeps sign-in.
      const url = entry.url;
      getSetupStatus(url)
        .then(needsSetup => {
          if (needsSetup) setAuthRoute(current => (current === "device-login" && serverRegistry.active()?.url === url ? "first-run-setup" : current));
        })
        .catch(() => undefined);
    }
  }

  function signOut() {
    if (session) serverRegistry.clearSession(session.serverUrl);
    setSession(null);
    setNavigationRestored(false);
    setRoute({ name: "main" });
    setAuthRoute(signedOutEntry());
  }

  function changeServer() {
    setSignedOutOf("");
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

  // Android openHomeSection / openLibrarySection: a library row on a mixed
  // library keeps the Movies/Series view's media scope on its full page.
  function openSectionBrowse(rail: HomeRail) {
    if (!rail.sectionId) return;
    const library = rail.libraryId != null ? libraries.find(candidate => candidate.id === rail.libraryId) : undefined;
    const mixed = library?.type.trim().toLowerCase() === "mixed";
    const mediaScope = mixed ? (section === "movies" ? "movie" : section === "series" ? "series" : null) : null;
    setSectionBrowse({ sectionId: rail.sectionId, title: rail.title, libraryId: rail.libraryId ?? null, mediaScope });
  }

  async function resolveNextEpisode(current: SiloItem): Promise<SiloItem | null> {
    if (!session || !current.SeriesId || current.ParentIndexNumber == null || current.IndexNumber == null) return null;
    const currentSeason = current.ParentIndexNumber;
    const episodes = await getEpisodes(session, current.SeriesId, currentSeason);
    const nextInSeason = nextEpisodeAfter(episodes, currentSeason, current.IndexNumber);
    if (nextInSeason) return nextInSeason;
    const seasons = await getSeasons(session, current.SeriesId);
    const nextSeason = seasons
      .filter(season => season.IndexNumber != null && season.IndexNumber > currentSeason)
      .sort((left, right) => left.IndexNumber! - right.IndexNumber!)[0];
    if (!nextSeason?.IndexNumber) return null;
    const nextSeasonEpisodes = await getEpisodes(session, current.SeriesId, nextSeason.IndexNumber);
    return firstEpisodeOfSeason(nextSeasonEpisodes);
  }

  function playExtra(trailer: { contentId?: string; title: string }) {
    if (!trailer.contentId) return;
    setRoute({ name: "player", item: { Id: trailer.contentId, Name: trailer.title, Type: "Extra" }, startPosition: 0 });
  }

  async function startShuffle(kind: string, id: string | number) {
    if (!session) throw new Error("A connected server session is required to shuffle.");
    const shuffle = await createShuffle(session, kind, id);
    setRoute({ name: "player", item: shuffle.current, startPosition: 0, shuffleId: shuffle.id, shuffleNext: shuffle.next, shuffleScope: shuffle.scopeLabel });
  }

  async function advanceShuffleRoute(shuffleId: string, finished: SiloItem, autoAdvanceCount = 0) {
    if (!session) return;
    try {
      const shuffle = await advanceShuffle(session, shuffleId, finished.Id);
      if (shuffle.current.Id === finished.Id) throw new Error("Nothing else can play.");
      setRoute({ name: "player", item: shuffle.current, startPosition: 0, shuffleId, shuffleNext: shuffle.next, shuffleScope: shuffle.scopeLabel, autoAdvanceCount });
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

  /**
   * Android clearProfile after deleting the active profile: its token is dead
   * server-side, so drop the selection and require a fresh pick.
   */
  function clearDeletedProfile() {
    if (!session) return;
    const cleared: Session = { ...session, profileId: undefined, profileToken: undefined, profileAvatar: undefined };
    serverRegistry.saveSession(cleared);
    localStorage.removeItem(NAVIGATION_KEY);
    setSession(cleared);
    setProfileError("Choose who is watching.");
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
    launchSelectionRequired = false;
    clearBackgrounded();
    setProfileError("");
    setProfileHydrated(true);
    setLibrariesLoaded(false);
    setRequestsAvailable(undefined);
    setSection("home");
    setRoute({ name: "main" });
    setNavigationRestored(true);
  }

  const signedOutNotice = signedOutOf ? `You were signed out of ${signedOutOf}. Sign in again.` : undefined;
  if (!session) {
    if (authRoute === "phone-setup") {
      // With a server saved, the other way in is code sign-in for that server. Without one,
      // the server's address comes first.
      const savedServer = Boolean(serverRegistry.active());
      return (
        <PhoneSetupScreen
          notice={signedOutNotice}
          manualLabel={savedServer ? "Sign in with a code" : "Enter server address"}
          onPaired={login}
          onManual={() => setAuthRoute(savedServer ? "device-login" : "server-setup")}
        />
      );
    }
    if (authRoute === "server-setup") return <ServerSetupScreen onContinue={(url) => { setSignedOutOf(""); chooseServer(url); }} />;
    if (authRoute === "first-run-setup") {
      return <FirstRunSetupScreen serverUrl={serverUrl} onComplete={login} onChangeServer={() => setAuthRoute("server-setup")} />;
    }
    if (authRoute === "signup") {
      return <SignupScreen serverUrl={serverUrl} onComplete={login} onBackToLogin={() => setAuthRoute("password-login")} />;
    }
    if (authRoute === "password-login") {
      return (
        <LoginScreen
          serverUrl={serverUrl}
          notice={signedOutNotice}
          onLogin={login}
          onDeviceLogin={() => setAuthRoute("device-login")}
          onCreateAccount={() => setAuthRoute("signup")}
          onChangeServer={() => setAuthRoute("server-setup")}
        />
      );
    }
    return (
      <DeviceLoginScreen
        serverUrl={serverUrl}
        notice={signedOutNotice}
        onLogin={login}
        onPasswordLogin={() => setAuthRoute("password-login")}
        onChangeServer={() => setAuthRoute("server-setup")}
      />
    );
  }

  const connectionLost = <ConnectionLost serverName={serverRegistry.active()?.name ?? "the server"} />;

  if (profileError) {
    return (
      <>
      <ProfileSelectionScreen
        key={connectionEpoch}
        session={session}
        onSelect={activateProfile}
        onChangeServer={changeServer}
        onSignOut={signOut}
        onActiveProfileDeleted={clearDeletedProfile}
        fullScreen
      />
      {connectionLost}
      </>
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
        key={route.item.Id}
        session={session}
        item={route.item}
        startPosition={route.startPosition}
        choices={route.choices}
        resolveNextEpisode={() => resolveNextEpisode(route.item)}
        autoAdvanceCount={route.autoAdvanceCount ?? 0}
        shuffle={route.shuffleId ? { id: route.shuffleId, scopeLabel: route.shuffleScope, next: route.shuffleNext } : undefined}
        onShuffleAdvance={(autoAdvanceCount) => {
          publishWatchState(applyWatchedState(route.item, true));
          void advanceShuffleRoute(route.shuffleId!, route.item, autoAdvanceCount);
        }}
        onPlayNext={(next, autoAdvanceCount) => {
          if (route.shuffleId && session) void deleteShuffle(session, route.shuffleId).catch(() => undefined);
          publishWatchState(applyWatchedState(route.item, true));
          const parentSeries = route.returnTo?.series ?? { Id: route.item.SeriesId ?? "", Name: route.item.SeriesName ?? "Series", Type: "Series" };
          setRoute({ name: "player", item: next, startPosition: 0, autoAdvanceCount, returnTo: { series: parentSeries, selectedEpisode: next } });
        }}
        onBack={(position) => {
          publishWatchState(applyResumeState(route.item, position));
          leavePlayer(route);
        }}
        onEnded={route.shuffleId ? () => void advanceShuffleRoute(route.shuffleId!, route.item) : () => {
          publishWatchState(applyWatchedState(route.item, true));
          leavePlayer(route);
        }}
      />
    );
  }

  if (route.name === "person") {
    return (
      <>
      <PersonScreen
        key={connectionEpoch}
        session={session}
        personId={route.personId}
        name={route.personName}
        onOpen={openItem}
      />
      {connectionLost}
      </>
    );
  }

  if (route.name === "series") {
    return (
      <>
      <SeriesScreen
        key={`${route.item.Id}-${connectionEpoch}`}
        session={session}
        series={route.item}
        initialEpisode={route.selectedEpisode}
        restoreCastIndex={route.castIndex}
        onOpenPerson={(person, index) => setRoute({ name: "person", personId: person.personId, personName: person.name, back: { ...route, castIndex: index } })}
        onPlayExtra={playExtra}
        onPlayEpisode={(episode, startPosition, choices) => setRoute({ name: "player", item: episode, startPosition, choices, returnTo: { series: route.item, selectedEpisode: episode } })}
        onShuffle={startShuffle}
        onOpen={openItem}
      />
      {connectionLost}
      </>
    );
  }

  if (route.name === "details") {
    return (
      <>
      <DetailsScreen
        key={connectionEpoch}
        session={session}
        item={route.item}
        restoreCastIndex={route.castIndex}
        onOpenPerson={(person, index) => setRoute({ name: "person", personId: person.personId, personName: person.name, back: { ...route, castIndex: index } })}
        onPlayExtra={playExtra}
        onPlay={(startPosition, choices) => setRoute({ name: "player", item: route.item, startPosition, choices })}
        onOpen={openItem}
      />
      {connectionLost}
      </>
    );
  }

  let body;
  if (sectionBrowse && (section === "home" || section === "movies" || section === "series" || section === "music" || section === "audiobooks")) {
    body = <SectionBrowseScreen key={`${sectionBrowse.libraryId ?? "home"}-${sectionBrowse.sectionId}`} session={session} args={sectionBrowse} onOpen={openItem} />;
  }
  else if (section === "home") body = <HomeScreen session={session} onOpen={openItem} onExplore={openSectionBrowse} />;
  else if (section === "forYou") body = <ForYouScreen session={session} onOpen={openItem} />;
  else if (section === "search") body = <SearchScreen session={session} onOpen={openItem} />;
  else if (section === "favorites" || section === "watchlist") {
    body = <PersonalScreen session={session} kind={section} onOpen={openItem} />;
  }
  else if (section === "history") body = <HistoryScreen session={session} onOpen={openItem} />;
  else if (section === "collections") body = <CollectionsScreen session={session} onOpen={openItem} />;
  else if (section === "profiles") {
    body = (
      <ProfileSelectionScreen
        session={session}
        onSelect={activateProfile}
        onChangeServer={changeServer}
        onSignOut={signOut}
        onActiveProfileDeleted={clearDeletedProfile}
      />
    );
  }
  else if (section === "settings") {
    body = <SettingsScreen session={session} onSignOut={signOut} onChangeServer={changeServer} onSwitchProfile={() => setSection("profiles")} />;
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
          onExplore={openSectionBrowse}
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
    <div className={`app-shell ${section === "library" || (["movies", "series", "music", "audiobooks"].includes(section) && (libraryLanding === "browse" || libraryLanding === "alphabet" || browseDetail !== null)) ? "app-shell-library" : ""} ${section === "home" && route.name === "main" && !sectionBrowse ? "app-shell-home" : ""}`}>
      {section !== "settings" && section !== "profiles" && <TopNav
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
          setSectionBrowse(null);
          setSection(next);
          setRoute({ name: "main" });
        }}
        onProfile={() => setSection("settings")}
        onFavorites={() => { setSection("favorites"); setRoute({ name: "main" }); }}
        onWatchlist={() => { setSection("watchlist"); setRoute({ name: "main" }); }}
        onHistory={() => { setSection("history"); setRoute({ name: "main" }); }}
        onProfiles={() => { setSection("profiles"); setRoute({ name: "main" }); }}
        onSignOut={signOut}
        onChangeServer={changeServer}
      />}
      <Fragment key={connectionEpoch}>{body}</Fragment>
      {connectionLost}
    </div>
  );
}
