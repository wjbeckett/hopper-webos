import type { HomeRail, ItemsResponse, Session, SiloCollection, SiloItem, SiloLibrary, SiloProfile } from "../types";
import { serverRegistry } from "../core/serverRegistry";

function normalizeServerUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function apiUrl(serverUrl: string, path: string): string {
  return `${normalizeServerUrl(serverUrl)}/api/v1${path}`;
}

export async function siloRequest<T>(
  session: Session,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const perform = () => fetch(apiUrl(session.serverUrl, path), {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
      ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {}),
      ...(init.headers ?? {})
    }
  });

  let response = await perform();
  if (response.status === 401 && session.refreshToken && path !== "/auth/refresh") {
    await refreshSession(session);
    response = await perform();
  }

  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${path}: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
  }
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`${path}: Silo returned ${contentType || "a non-JSON response"}`);
  }
  return response.json() as Promise<T>;
}

const request = siloRequest;

type RefreshResponse = { access_token: string; refresh_token: string; expires_in?: number };
const refreshes = new Map<string, Promise<void>>();

async function refreshSession(session: Session): Promise<void> {
  const key = `${session.serverUrl}|${session.userId}`;
  const existing = refreshes.get(key);
  if (existing) return existing;

  const refresh = (async () => {
    const response = await fetch(apiUrl(session.serverUrl, "/auth/refresh"), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken })
    });
    if (!response.ok) throw new Error("AUTH_EXPIRED");
    const tokens = await response.json() as RefreshResponse;
    if (!tokens.access_token || !tokens.refresh_token) throw new Error("AUTH_EXPIRED");
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    serverRegistry.saveSession(session);
  })().finally(() => refreshes.delete(key));

  refreshes.set(key, refresh);
  return refresh;
}

type NativeItem = Record<string, unknown> & {
  content_id?: string | number;
  id?: string | number;
  title?: string;
  name?: string;
  type?: string;
  media_type?: string;
  poster_url?: string;
  backdrop_url?: string;
  overview?: string;
  description?: string;
  year?: number;
  release_year?: number;
  duration?: number;
  duration_seconds?: number;
  series_id?: string | number;
  series_title?: string;
  season_number?: number;
  episode_number?: number;
  episode_count?: number;
  runtime?: number;
  still_url?: string;
  user_data?: { played?: boolean; position_seconds?: number; progress_percent?: number };
};

type NativeList = NativeItem[] | { items?: NativeItem[]; total?: number; total_count?: number };

type NativeHomeLayout = {
  sections?: Array<{
    id: string | number;
    title?: string;
    section_type?: string;
    featured?: boolean;
    item_limit?: number;
  }>;
};

type NativeHomeSectionResponse = {
  section?: {
    items?: NativeItem[];
  };
};

type NativeLibrary = {
  id: number | string;
  name?: string;
  type?: string;
  library_type?: string;
};

function itemType(value?: string) {
  const types: Record<string, string> = {
    movie: "Movie",
    series: "Series",
    episode: "Episode",
    season: "Season",
    audiobook: "AudioBook",
    audio: "Audio",
    music: "MusicAlbum"
  };
  return types[value?.toLowerCase() ?? ""] ?? value;
}

function toItem(item: NativeItem): SiloItem {
  const duration = item.duration_seconds ?? item.duration;
  return {
    Id: String(item.content_id ?? item.id ?? ""),
    Name: item.title ?? item.name ?? "Untitled",
    Type: itemType(item.type ?? item.media_type),
    SeriesName: item.series_title,
    SeriesId: item.series_id == null ? undefined : String(item.series_id),
    ParentIndexNumber: item.season_number,
    IndexNumber: item.episode_number ?? (itemType(item.type ?? item.media_type) === "Season" ? item.season_number : undefined),
    ProductionYear: item.release_year ?? item.year,
    Overview: item.overview ?? item.description,
    RunTimeTicks: typeof (item.runtime ?? duration) === "number" ? (item.runtime ?? duration)! * 10_000_000 : undefined,
    PosterUrl: item.poster_url ?? item.still_url,
    BackdropUrl: item.backdrop_url,
    UserData: item.user_data ? {
      Played: item.user_data.played,
      PlaybackPositionTicks: item.user_data.position_seconds == null
        ? undefined
        : item.user_data.position_seconds * 10_000_000,
      PlayedPercentage: item.user_data.progress_percent
    } : undefined
  };
}

function unpack(data: NativeList): ItemsResponse {
  const items = Array.isArray(data) ? data : data.items ?? [];
  return {
    Items: items.map(toItem).filter((item) => item.Id),
    TotalRecordCount: Array.isArray(data) ? data.length : data.total ?? data.total_count
  };
}

type NativeAuth = {
  access_token: string;
  refresh_token?: string;
  user?: { id?: string | number; username?: string; name?: string };
  profile_id?: string;
  profile_token?: string;
};

type NativeProfile = {
  id: string | number;
  name?: string;
  avatar_emoji?: string;
  avatar?: string;
  avatar_url?: string;
  has_pin?: boolean;
  is_primary?: boolean;
};

export async function getProfiles(session: Session): Promise<SiloProfile[]> {
  const data = await request<NativeProfile[] | { profiles?: NativeProfile[] }>(session, "/profiles");
  const profiles = Array.isArray(data) ? data : data.profiles ?? [];
  return profiles.map((profile) => ({
    id: String(profile.id),
    name: profile.name ?? "Profile",
    avatarEmoji: profile.avatar ?? profile.avatar_emoji,
    avatarUrl: profile.avatar_url,
    hasPin: Boolean(profile.has_pin),
    isPrimary: Boolean(profile.is_primary)
  }));
}

export async function restoreDefaultProfile(session: Session): Promise<Session> {
  const profiles = await getProfiles(session);
  const profile = profiles.find((candidate) => candidate.id === session.profileId)
    ?? profiles.find((candidate) => candidate.isPrimary)
    ?? (profiles.length === 1 ? profiles[0] : profiles.find((candidate) => !candidate.hasPin));
  if (!profile) throw new Error("Choose a Silo profile before opening the dashboard.");
  if (profile.hasPin) throw new Error(`The profile ${profile.name} requires a PIN.`);
  return {
    ...session,
    profileId: profile.id,
    profileAvatar: profile.avatarUrl ?? profile.avatarEmoji,
    profileMetadataLoaded: true,
    username: profile.name
  };
}

export async function authenticate(serverUrl: string, username: string, password: string): Promise<Session> {
  const response = await fetch(apiUrl(serverUrl, "/auth/login"), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const data = await response.json() as NativeAuth;
  if (!data.access_token) throw new Error("Silo login did not return an access token.");
  return {
    serverUrl: normalizeServerUrl(serverUrl),
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    profileId: data.profile_id,
    profileToken: data.profile_token,
    userId: String(data.user?.id ?? data.profile_id ?? ""),
    username: data.user?.username ?? data.user?.name ?? username
  };
}

function catalogPath(type: string, offset = 0, limit = 60, q?: string) {
  const params = new URLSearchParams({ source: "query", type, offset: String(offset), limit: String(limit) });
  if (q) params.set("q", q);
  return `/catalog?${params}`;
}

export async function getHomeRails(session: Session): Promise<HomeRail[]> {
  const layout = await request<NativeHomeLayout>(session, "/home/layout");
  const sections = layout.sections ?? [];

  const results = await Promise.allSettled(
    sections.map((section) =>
      request<NativeHomeSectionResponse>(
        session,
        `/home/sections/${encodeURIComponent(String(section.id))}/items`
      )
    )
  );

  const failed = results.filter((result) => result.status === "rejected");
  if (sections.length > 0 && failed.length === sections.length) {
    const first = failed[0] as PromiseRejectedResult;
    throw first.reason instanceof Error
      ? first.reason
      : new Error("Silo could not load the profile home sections.");
  }

  return sections.map((section, index) => {
    const result = results[index];
    const nativeItems = result.status === "fulfilled"
      ? result.value.section?.items ?? []
      : [];
    return {
      id: String(section.id),
      title: section.title ?? section.section_type ?? "Silo",
      featured: section.featured,
      items: nativeItems.map(toItem).filter((item) => item.Id)
    };
  }).filter((rail) => rail.items.length > 0);
}

export async function getLibraries(session: Session): Promise<SiloLibrary[]> {
  const data = await request<NativeLibrary[] | { libraries?: NativeLibrary[] }>(session, "/user/libraries");
  const libraries = Array.isArray(data) ? data : data.libraries ?? [];
  return libraries.map((library) => ({
    id: Number(library.id),
    name: library.name ?? "Library",
    type: (library.type ?? library.library_type ?? "").toLowerCase()
  })).filter((library) => Number.isFinite(library.id) && library.id > 0);
}

export async function getLibraryRails(session: Session, library: SiloLibrary): Promise<HomeRail[]> {
  const layout = await request<NativeHomeLayout>(session, `/library/${library.id}/layout`);
  const sections = layout.sections ?? [];
  const results = await Promise.allSettled(sections.map((section) =>
    request<NativeHomeSectionResponse>(
      session,
      `/library/${library.id}/sections/${encodeURIComponent(String(section.id))}/items`
    )
  ));

  return sections.map((section, index) => {
    const result = results[index];
    const items = result.status === "fulfilled" ? result.value.section?.items ?? [] : [];
    return {
      id: `${library.id}-${section.id}`,
      title: section.title ?? section.section_type ?? library.name,
      featured: section.featured,
      items: items.map(toItem).filter((item) => item.Id)
    };
  }).filter((rail) => rail.items.length > 0);
}

export async function getLibrariesRails(session: Session, libraries: SiloLibrary[]): Promise<HomeRail[]> {
  const results = await Promise.allSettled(libraries.map((library) => getLibraryRails(session, library)));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

type NativeCollection = {
  id: string | number;
  title?: string;
  name?: string;
  item_count?: number;
  poster_url?: string;
  kind?: string;
};

type NativeCollectionGroup = {
  name?: string;
  kind?: string;
  collections?: NativeCollection[];
};

type NativeCollectionsResponse = NativeCollection[] | {
  collections?: NativeCollection[];
  groups?: NativeCollectionGroup[];
  ungrouped?: { collections?: NativeCollection[] };
};

function toCollection(item: NativeCollection, groupName?: string, groupKind?: string): SiloCollection {
  const rawKind = item.kind ?? groupKind;
  return {
    id: String(item.id),
    name: item.title ?? item.name ?? "Collection",
    itemCount: item.item_count,
    posterUrl: item.poster_url,
    kind: rawKind === "user_collections" || rawKind === "user_collection" ? "user_collection" : "regular",
    groupName
  };
}

export async function getLibraryCollections(session: Session, libraryId: number): Promise<SiloCollection[]> {
  const data = await request<NativeCollectionsResponse>(session, `/library/${libraryId}/collections`);
  if (Array.isArray(data)) return data.map((item) => toCollection(item));
  if (data.groups?.length || data.ungrouped) {
    return [
      ...(data.groups ?? []).flatMap((group) =>
        (group.collections ?? []).map((item) => toCollection(item, group.name, group.kind))
      ),
      ...(data.ungrouped?.collections ?? []).map((item) => toCollection(item))
    ];
  }
  return (data.collections ?? []).map((item) => toCollection(item));
}

export async function getCollectionItems(session: Session, collection: SiloCollection): Promise<SiloItem[]> {
  const params = new URLSearchParams({
    source: collection.kind === "user_collection" ? "user_collection" : "library_collection",
    collection_id: collection.id,
    offset: "0",
    limit: "100",
    include_total: "false"
  });
  return unpack(await request<NativeList>(session, `/catalog?${params}`)).Items;
}

export async function getFavorites(session: Session): Promise<SiloItem[]> {
  return unpack(await request<NativeList>(session, "/favorites?offset=0&limit=100")).Items;
}

export async function getWatchlist(session: Session): Promise<SiloItem[]> {
  return unpack(await request<NativeList>(session, "/watchlist?offset=0&limit=100")).Items;
}

async function personalItemExists(session: Session, kind: "favorites" | "watchlist", contentId: string) {
  const response = await fetch(apiUrl(session.serverUrl, `/${kind}/${encodeURIComponent(contentId)}`), {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
      ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {})
    }
  });
  if (response.status === 404) return false;
  if (response.ok) return true;
  throw new Error(`${kind}: ${response.status} ${response.statusText}`);
}

export function isFavorite(session: Session, contentId: string) {
  return personalItemExists(session, "favorites", contentId);
}

export function isInWatchlist(session: Session, contentId: string) {
  return personalItemExists(session, "watchlist", contentId);
}

export async function setFavorite(session: Session, contentId: string, enabled: boolean) {
  await request<void>(session, `/favorites/${encodeURIComponent(contentId)}`, { method: enabled ? "PUT" : "DELETE" });
}

export async function setWatchlist(session: Session, contentId: string, enabled: boolean) {
  await request<void>(session, `/watchlist/${encodeURIComponent(contentId)}`, { method: enabled ? "PUT" : "DELETE" });
}

export async function searchItems(session: Session, query: string): Promise<SiloItem[]> {
  if (!query.trim()) return [];
  return unpack(await request<NativeList>(session, catalogPath("all", 0, 60, query.trim()))).Items;
}

export async function getCatalogItem(session: Session, contentId: string): Promise<SiloItem> {
  const data = await request<NativeItem>(session, `/catalog/items/${encodeURIComponent(contentId)}`);
  return toItem(data);
}

export type SiloAppearance = { theme: string; variables: Record<string, string>; textScale: string; textWeight: string; highContrast: boolean };

export async function getProfileAppearance(session: Session): Promise<SiloAppearance> {
  const keys = "ui.theme,ui.custom_theme_vars,ui.text_scale,ui.text_weight,ui.high_contrast";
  const data = await request<{ settings?: Array<{ key: string; effective_value?: string }> }>(session, `/settings/effective?keys=${encodeURIComponent(keys)}`);
  const values = new Map((data.settings ?? []).map(entry => [entry.key, entry.effective_value ?? ""]));
  let variables: Record<string, string> = {};
  try {
    const parsed = JSON.parse(values.get("ui.custom_theme_vars") || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) variables = parsed as Record<string, string>;
  } catch { /* Invalid custom values must not break the TV shell. */ }
  return {
    theme: values.get("ui.theme") || "midnight-cinema",
    variables,
    textScale: values.get("ui.text_scale") || "default",
    textWeight: values.get("ui.text_weight") || "default",
    highContrast: values.get("ui.high_contrast") === "true"
  };
}

export async function getSeasons(session: Session, seriesId: string): Promise<SiloItem[]> {
  const data = await request<{ seasons?: NativeItem[] }>(
    session,
    `/catalog/series/${encodeURIComponent(seriesId)}/seasons`
  );
  return (data.seasons ?? []).map((season) => toItem({ ...season, type: "season" }));
}

export async function getEpisodes(session: Session, seriesId: string, seasonNumber: number): Promise<SiloItem[]> {
  const data = await request<{ episodes?: NativeItem[] }>(
    session,
    `/catalog/series/${encodeURIComponent(seriesId)}/seasons/${seasonNumber}/episodes`
  );
  return (data.episodes ?? []).map((episode) => toItem({ ...episode, type: "episode", series_id: seriesId }));
}

function assetUrl(session: Session, value?: string) {
  if (!value) return "";
  if (/^https?:\/\//.test(value)) return value;
  return `${normalizeServerUrl(session.serverUrl)}${value.startsWith("/") ? "" : "/"}${value}`;
}

export function imageUrl(session: Session, item: SiloItem | string): string {
  return typeof item === "string" ? "" : assetUrl(session, item.PosterUrl);
}

export function backdropUrl(session: Session, item: SiloItem | string): string {
  return typeof item === "string" ? "" : assetUrl(session, item.BackdropUrl ?? item.PosterUrl);
}
