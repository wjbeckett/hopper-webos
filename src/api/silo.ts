import { titleArtEnabled } from "../core/titleArt";
import type { ThemeSelection } from "../core/themeMusic";
import type { HomeRail, ItemsResponse, Session, SiloCalendarDay, SiloCalendarItem, SiloCollection, SiloItem, SiloLibrary, SiloMediaRequest, SiloProfile, SiloRequestResult } from "../types";
import { serverRegistry } from "../core/serverRegistry";
import { getDeviceId } from "../platform/device";

function normalizeServerUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function apiUrl(serverUrl: string, path: string, version = "v2"): string {
  return `${normalizeServerUrl(serverUrl)}/api/${version}${path}`;
}

async function requestApi<T>(
  session: Session,
  path: string,
  init: RequestInit,
  version: string,
  includeProfile = true
): Promise<T> {
  const perform = () => fetch(apiUrl(session.serverUrl, path, version), {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...(includeProfile && session.profileId ? { "X-Profile-Id": session.profileId } : {}),
      ...(includeProfile && session.profileToken ? { "X-Profile-Token": session.profileToken } : {}),
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

export function requestV2<T>(session: Session, path: string, init: RequestInit = {}) {
  return requestApi<T>(session, path, init, "v2");
}

/** Absolute v2 URL for a raw (non-JSON) request such as the bandwidth probe. */
export function v2Url(session: Session, path: string): string {
  return apiUrl(session.serverUrl, path, "v2");
}

type RefreshResponse = { access_token: string; refresh_token: string; expires_in?: number };
const refreshes = new Map<string, Promise<void>>();

export async function refreshSession(session: Session): Promise<void> {
  const key = `${session.serverUrl}|${session.userId}`;
  const existing = refreshes.get(key);
  if (existing) return existing;

  const refresh = (async () => {
    const response = await fetch(apiUrl(session.serverUrl, "/auth/refresh", "v2"), {
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
  poster_is_episode_still?: boolean;
  backdrop_is_episode_still?: boolean;
  overview?: string;
  description?: string;
  year?: number;
  release_year?: number;
  release_date?: string;
  added_at?: string;
  date_added?: string;
  resolution?: string;
  author?: string;
  narrator?: string;
  publisher?: string;
  audiobook?: {
    authors?: Array<{ name?: string }>;
    narrators?: Array<{ name?: string }>;
    publisher?: string;
    total_duration_seconds?: number;
  };
  duration?: number;
  duration_seconds?: number;
  series_id?: string | number;
  series_title?: string;
  season_number?: number;
  episode_number?: number;
  episode_count?: number;
  season_count?: number;
  air_date?: string;
  runtime?: number;
  runtime_minutes?: number;
  runtime_seconds?: number;
  sort_metrics?: {
    author?: string;
    narrator?: string;
    series_name?: string;
    runtime_minutes?: number;
    release_date?: string;
    resolution?: string;
  };
  overlay_summary?: {
    resolution?: string;
  };
  genres?: string[];
  content_rating?: string;
  rating_imdb?: number;
  rating_tmdb?: number;
  logo_url?: string;
  still_url?: string;
  progress_percent?: number;
  position_seconds?: number;
  user_data?: {
    played?: boolean;
    position_seconds?: number;
    progress_percent?: number;
  };
  user_state?: {
    played?: boolean;
    is_favorite?: boolean;
    in_watchlist?: boolean;
    position_seconds?: number;
    progress_percent?: number;
  };
};

type NativeList = NativeItem[] | { items?: NativeItem[]; total?: number; total_count?: number };

type NativeCatalogPage = {
  items?: NativeItem[];
  page?: {
    has_more?: boolean;
    next_cursor?: string;
  };
};

export type CatalogQueryRule = {
  field: string;
  op: string;
  value: string | string[];
};

export type CatalogQueryGroup = {
  match: "all" | "any";
  rules: CatalogQueryRule[];
};

export type CatalogFilterOptions = {
  genres: string[];
  studios: string[];
  networks: string[];
  countries: string[];
  originalLanguages: string[];
  contentRatings: string[];
  authors: string[];
  narrators: string[];
  series: string[];
  resolutions: string[];
  audioLanguages: string[];
  subtitleLanguages: string[];
};

export type CatalogScope = { source: "library_collection" | "user_collection"; collectionId: string };

export async function searchCatalogFacet(
  session: Session,
  libraryIds: Array<number | string>,
  facet: "author" | "narrator" | "series",
  query: string,
  limit = 100,
  scope?: CatalogScope
): Promise<{ matches: string[]; hasMore: boolean }> {
  const params = new URLSearchParams({ source: scope?.source ?? "query", facet, q: query, limit: String(limit) });
  if (scope) params.set("collection_id", scope.collectionId);
  for (const id of libraryIds) params.append("library_ids", String(id));
  const response = await requestV2<{ matches?: string[]; has_more?: boolean }>(
    session,
    `/catalog/filters/search?${params}`
  );
  return { matches: response.matches ?? [], hasMore: response.has_more ?? false };
}

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
  items?: NativeItem[];
};

type NativeRecommendationRow = {
  type: string;
  title: string;
  items: NativeItem[];
};

type NativeRecommendationRows = {
  items?: NativeRecommendationRow[];
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
  const runtimeMinutes = item.sort_metrics?.runtime_minutes ?? item.runtime_minutes;
  const runtimeSeconds = item.audiobook?.total_duration_seconds
    ?? item.duration_seconds
    ?? item.runtime_seconds
    ?? item.duration
    ?? (typeof runtimeMinutes === "number"
      ? runtimeMinutes * 60
      : typeof item.runtime === "number"
        ? item.runtime * 60 : undefined);
  const position = item.position_seconds ?? item.user_data?.position_seconds ?? item.user_state?.position_seconds;
  const progress = item.progress_percent
    ?? item.user_data?.progress_percent
    ?? item.user_state?.progress_percent
    ?? (typeof position === "number" && typeof runtimeSeconds === "number" && runtimeSeconds > 0
      ? position / runtimeSeconds * 100
      : undefined);
  const userState = {
    Played: item.user_state?.played ?? item.user_data?.played,
    IsFavorite: item.user_state?.is_favorite,
    InWatchlist: item.user_state?.in_watchlist,
    PlaybackPositionTicks: position == null ? undefined : position * 10_000_000,
    PlayedPercentage: progress
  };
  const hasUserState = Boolean(item.user_data || item.user_state || position != null || progress != null);
  return {
    Id: String(item.content_id ?? item.id ?? ""),
    Name: item.title ?? item.name ?? "Untitled",
    Type: itemType(item.type ?? item.media_type),
    SeriesName: item.sort_metrics?.series_name ?? item.series_title,
    SeriesId: item.series_id == null ? undefined : String(item.series_id),
    ParentIndexNumber: item.season_number,
    IndexNumber: item.episode_number ?? (itemType(item.type ?? item.media_type) === "Season" ? item.season_number : undefined),
    ProductionYear: item.release_year ?? item.year,
    DateAdded: item.added_at ?? item.date_added,
    ReleaseDate: item.sort_metrics?.release_date ?? item.release_date,
    AirDate: item.air_date,
    SeasonCount: item.season_count,
    EpisodeCount: item.episode_count,
    Resolution: item.sort_metrics?.resolution ?? item.overlay_summary?.resolution ?? item.resolution,
    Author: item.sort_metrics?.author ?? item.author,
    Narrator: item.sort_metrics?.narrator ?? item.narrator,
    Publisher: item.audiobook?.publisher ?? item.publisher,
    AudiobookDurationSeconds: item.audiobook?.total_duration_seconds,
    AudiobookAuthorNames: item.audiobook?.authors?.map(person => person.name).filter((name): name is string => Boolean(name?.trim())).join(", ") || item.sort_metrics?.author || item.author,
    AudiobookNarratorNames: item.audiobook?.narrators?.map(person => person.name).filter((name): name is string => Boolean(name?.trim())).join(", ") || item.sort_metrics?.narrator || item.narrator,
    Overview: item.overview ?? item.description,
    Genres: item.genres,
    ContentRating: item.content_rating,
    ImdbRating: item.rating_imdb,
    TmdbRating: item.rating_tmdb,
    RuntimeMinutes: typeof runtimeSeconds === "number" ? Math.round(runtimeSeconds / 60) : undefined,
    RunTimeTicks: typeof runtimeSeconds === "number" ? runtimeSeconds * 10_000_000 : undefined,
    PosterUrl: item.poster_url ?? item.still_url,
    BackdropUrl: item.backdrop_url,
    PosterIsEpisodeStill: item.poster_is_episode_still,
    BackdropIsEpisodeStill: item.backdrop_is_episode_still,
    LogoUrl: item.logo_url,
    UserData: hasUserState ? userState : undefined
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
  const data = await requestV2<{ items?: NativeProfile[] }>(session, "/profiles");
  const profiles = data.items ?? [];
  return profiles.map((profile) => ({
    id: String(profile.id),
    name: profile.name ?? "Profile",
    avatarEmoji: profile.avatar ?? profile.avatar_emoji,
    avatarUrl: profile.avatar_url,
    hasPin: Boolean(profile.has_pin),
    isPrimary: Boolean(profile.is_primary)
  }));
}

export async function getHouseholdProfiles(session: Session): Promise<SiloProfile[]> {
  const data = await requestApi<{ items?: NativeProfile[] }>(session, "/profiles", {}, "v2", false);
  return (data.items ?? []).map(profile => ({
    id: String(profile.id),
    name: profile.name ?? "Profile",
    avatarEmoji: profile.avatar ?? profile.avatar_emoji,
    avatarUrl: profile.avatar_url,
    hasPin: Boolean(profile.has_pin),
    isPrimary: Boolean(profile.is_primary)
  }));
}

export async function verifyProfilePin(session: Session, profileId: string, pin: string): Promise<string> {
  const result = await requestApi<{ valid: boolean; profile_token?: string }>(
    session,
    `/profiles/${encodeURIComponent(profileId)}/verify-pin`,
    { method: "POST", body: JSON.stringify({ pin }) },
    "v2",
    false
  );
  if (!result.valid || !result.profile_token) throw new Error("The PIN was not accepted.");
  return result.profile_token;
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
  const response = await fetch(apiUrl(serverUrl, "/auth/login", "v2"), {
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

function catalogPath(type: string, limit = 60, q?: string) {
  const params = new URLSearchParams({ source: "query", type, limit: String(limit) });
  if (q) params.set("q", q);
  return `/catalog?${params}`;
}

export async function getHomeRails(session: Session): Promise<HomeRail[]> {
  const layout = await requestV2<NativeHomeLayout>(session, "/home/layout");
  const sections = layout.sections ?? [];

  const results = await Promise.allSettled(
    sections.map((section) =>
      requestV2<NativeHomeSectionResponse>(
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
      ? result.value.items ?? []
      : [];
    return {
      id: String(section.id),
      title: section.title ?? section.section_type ?? "Silo",
      featured: section.featured,
      items: nativeItems.map(toItem).filter((item) => item.Id)
    };
  }).filter((rail) => rail.items.length > 0);
}

export async function getForYouRails(session: Session): Promise<HomeRail[]> {
  const response = await requestV2<NativeRecommendationRows>(session, "/recommendations/for-you/rows?limit=20");
  return (response.items ?? [])
    .map((row, index) => ({
      id: `for-you-${row.type}-${index}`,
      title: row.title,
      items: row.items.map(toItem).filter(item => item.Id)
    }))
    .filter(rail => rail.items.length > 0);
}

export async function getCalendar(
  session: Session,
  start: string,
  end: string,
  filter: "all" | "following" | "trending" = "all"
): Promise<SiloCalendarDay[]> {
  const params = new URLSearchParams({ start, end, filter, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const response = await requestV2<{ events?: Array<{ date: string; items?: Array<Record<string, unknown>> }> }>(
    session,
    `/calendar?${params}`
  );
  return (response.events ?? []).map(day => ({
    date: day.date,
    items: (day.items ?? []).map((raw): SiloCalendarItem => ({
      contentId: String(raw.content_id ?? ""),
      type: String(raw.type ?? ""),
      title: String(raw.title ?? "Untitled"),
      episodeTitle: typeof raw.episode_title === "string" ? raw.episode_title : undefined,
      seriesId: raw.series_id == null ? undefined : String(raw.series_id),
      seasonNumber: typeof raw.season_number === "number" ? raw.season_number : undefined,
      episodeNumber: typeof raw.episode_number === "number" ? raw.episode_number : undefined,
      airDate: String(raw.air_date ?? day.date),
      airTime: typeof raw.air_time === "string" ? raw.air_time : undefined,
      localAirDate: String(raw.local_air_date ?? day.date),
      posterUrl: typeof raw.poster_url === "string" ? raw.poster_url : undefined,
      watched: raw.watched === true,
      badges: Array.isArray(raw.badges) ? raw.badges.filter((badge): badge is string => typeof badge === "string") : []
    })).filter(item => item.contentId)
  }));
}

type NativeRequestResult = {
  media_type: string;
  tmdb_id: number;
  title: string;
  year?: number;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  availability?: string;
  library_content_id?: string;
  request?: {
    requestable?: boolean;
    reason?: string;
    request_id?: string;
    following?: boolean;
  };
};

type NativeMediaRequest = {
  id: string;
  media_type: string;
  tmdb_id: number;
  title: string;
  year?: number;
  status: string;
  outcome: string;
  state?: string;
  created_at: string;
};

function toRequestResult(item: NativeRequestResult): SiloRequestResult {
  return {
    mediaType: item.media_type,
    tmdbId: item.tmdb_id,
    title: item.title,
    year: item.year,
    overview: item.overview ?? "",
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    availability: item.availability ?? "missing",
    libraryContentId: item.library_content_id,
    requestable: item.request?.requestable === true,
    reason: item.request?.reason ?? "",
    requestId: item.request?.request_id,
    following: item.request?.following === true
  };
}

function toMediaRequest(request: NativeMediaRequest): SiloMediaRequest {
  return {
    id: request.id,
    mediaType: request.media_type,
    tmdbId: request.tmdb_id,
    title: request.title,
    year: request.year,
    status: request.status,
    outcome: request.outcome,
    state: request.state,
    createdAt: request.created_at
  };
}

function tvRequestType(mediaType: string) {
  return ["movie", "series", "audiobook"].includes(mediaType.toLowerCase());
}

export async function getRequestsFeatureStatus(session: Session) {
  return requestV2<{
    requests_enabled: boolean;
    allowed?: boolean;
    state?: string;
    follow_supported?: boolean;
  }>(session, "/requests/status");
}

export async function getRequestsDiscover(session: Session) {
  const response = await requestV2<{
    items?: Array<{ key: string; title: string; results?: NativeRequestResult[] }>;
    row_order?: Array<{ key: string }>;
  }>(session, "/requests/discover");
  const rows = response.items ?? [];
  const byKey = new Map(rows.map(row => [row.key, row]));
  const orderedRows = response.row_order?.length
    ? [
      ...response.row_order.flatMap(reference => {
        const row = byKey.get(reference.key);
        return row ? [row] : [];
      }),
      ...rows.filter(row => !response.row_order?.some(reference => reference.key === row.key))
    ]
    : rows;
  return orderedRows.map(row => ({
    key: row.key,
    title: row.title,
    items: (row.results ?? []).filter(item => tvRequestType(item.media_type)).map(toRequestResult)
  }));
}

export async function searchRequests(session: Session, query: string, mediaType = "all") {
  const params = new URLSearchParams({ q: query, media_type: mediaType, page: "1" });
  const response = await requestV2<{ results?: NativeRequestResult[] }>(session, `/requests/search?${params}`);
  return (response.results ?? []).filter(item => tvRequestType(item.media_type)).map(toRequestResult);
}

export async function getRequestDetail(session: Session, item: SiloRequestResult) {
  const response = await requestV2<NativeRequestResult>(
    session,
    `/requests/detail/${encodeURIComponent(item.mediaType)}/${item.tmdbId}`
  );
  return toRequestResult(response);
}

export async function getMyRequests(session: Session) {
  const requests: SiloMediaRequest[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    const response = await requestV2<{
      items?: NativeMediaRequest[];
      page?: { has_more?: boolean; next_cursor?: string };
    }>(session, `/requests/mine?${params}`);
    requests.push(...(response.items ?? []).filter(item => tvRequestType(item.media_type)).map(toMediaRequest));
    if (!response.page?.has_more) return requests;
    const next = response.page.next_cursor;
    if (!next || seenCursors.has(next)) throw new Error("Silo returned invalid request pagination.");
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error("The request list exceeded the page limit.");
}

export async function createMediaRequest(session: Session, item: SiloRequestResult) {
  const response = await requestApi<NativeMediaRequest>(session, "/requests", {
    method: "POST",
    body: JSON.stringify({
      media_type: item.mediaType,
      tmdb_id: item.tmdbId,
      title: item.title,
      year: item.year,
      overview: item.overview,
      poster_path: item.posterPath,
      backdrop_path: item.backdropPath
    })
  }, "v2");
  return toMediaRequest(response);
}

export async function cancelMediaRequest(session: Session, requestId: string) {
  const response = await requestApi<NativeMediaRequest>(
    session,
    `/requests/${encodeURIComponent(requestId)}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
    "v2"
  );
  return toMediaRequest(response);
}

export async function setRequestFollow(session: Session, item: SiloRequestResult, following: boolean) {
  const method = following ? "PUT" : "DELETE";
  await requestApi<void>(
    session,
    `/requests/follows/${encodeURIComponent(item.mediaType)}/${item.tmdbId}`,
    { method },
    "v2"
  );
}

export async function getLibraries(session: Session): Promise<SiloLibrary[]> {
  const data = await requestV2<{ items?: NativeLibrary[] }>(session, "/user/libraries");
  const libraries = data.items ?? [];
  return libraries.map((library) => ({
    id: Number(library.id),
    name: library.name ?? "Library",
    type: (library.type ?? library.library_type ?? "").toLowerCase()
  })).filter((library) => Number.isFinite(library.id) && library.id > 0);
}

export async function getLibraryRails(session: Session, library: SiloLibrary): Promise<HomeRail[]> {
  const layout = await requestV2<NativeHomeLayout>(session, `/library/${library.id}/layout`);
  const sections = layout.sections ?? [];
  const results = await Promise.allSettled(sections.map((section) =>
    requestV2<NativeHomeSectionResponse>(
      session,
      `/library/${library.id}/sections/${encodeURIComponent(String(section.id))}/items`
    )
  ));

  return sections.map((section, index) => {
    const result = results[index];
    const items = result.status === "fulfilled" ? result.value.items ?? [] : [];
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

export async function getCollections(session: Session): Promise<SiloCollection[]> {
  const response = await requestV2<{
    items?: Array<NativeCollection & { description?: string; group_id?: string | null }>;
    groups?: Array<{ id: string; name: string }>;
  }>(session, "/collections");
  const groupNames = new Map((response.groups ?? []).map(group => [group.id, group.name]));
  return (response.items ?? []).map(collection =>
    toCollection(collection, collection.group_id ? groupNames.get(collection.group_id) : undefined, "user_collection")
  );
}

export async function getCollectionItemsPage(
  session: Session,
  collection: SiloCollection,
  cursor?: string
): Promise<{ items: SiloItem[]; nextCursor?: string }> {
  const params = new URLSearchParams({
    source: "user_collection",
    collection_id: collection.id,
    limit: "40"
  });
  if (cursor) params.set("cursor", cursor);
  const page = await requestV2<NativeCatalogPage>(session, `/catalog?${params}`);
  if (page.page?.has_more && !page.page.next_cursor) {
    throw new Error("Silo returned another collection page without a continuation cursor.");
  }
  return {
    items: (page.items ?? []).map(toItem).filter(item => item.Id),
    nextCursor: page.page?.has_more ? page.page.next_cursor : undefined
  };
}

export async function getHistoryPage(
  session: Session,
  cursor?: string,
  limit = 40
): Promise<{ items: SiloItem[]; nextCursor?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const page = await requestV2<{
    items?: NativeItem[];
    page?: { has_more?: boolean; next_cursor?: string };
  }>(session, `/history?${params}`);
  if (page.page?.has_more && !page.page.next_cursor) {
    throw new Error("Silo returned another history page without a continuation cursor.");
  }
  return {
    items: (page.items ?? []).map(toItem).filter(item => item.Id),
    nextCursor: page.page?.has_more ? page.page.next_cursor : undefined
  };
}

export async function getLibraryItemsPage(
  session: Session,
  libraryId: number | string,
  cursor?: string,
  type?: string,
  limit = 100,
  sort = "title",
  order: "asc" | "desc" = "asc",
  groups: CatalogQueryGroup[] = [],
  match: "all" | "any" = "all",
  namePrefix?: string,
  scope?: CatalogScope
): Promise<{ items: SiloItem[]; nextCursor?: string }> {
  const collectionOrder = sort === "collection";
  const includeLibrary = !scope || Boolean(type);
  if (groups.length) {
    const page = await requestV2<NativeCatalogPage>(session, "/catalog/query", {
      method: "POST",
      body: JSON.stringify({
        source: scope?.source ?? "query",
        ...(scope ? { collection_id: scope.collectionId } : {}),
        ...(includeLibrary ? { library_id: String(libraryId) } : {}),
        ...(type ? { type: type.toLowerCase() } : {}),
        ...(collectionOrder ? {} : { sort, order }),
        match,
        groups,
        limit,
        ...(namePrefix ? { name_prefix: namePrefix } : {}),
        ...(cursor ? { cursor } : {})
      })
    });
    if (page.page?.has_more && !page.page.next_cursor) {
      throw new Error("Silo returned another library page without a continuation cursor.");
    }
    return {
      items: (page.items ?? []).map(toItem).filter(item => item.Id),
      nextCursor: page.page?.has_more ? page.page.next_cursor : undefined
    };
  }

  const params = new URLSearchParams({
    source: scope?.source ?? "query",
    limit: String(limit)
  });
  if (scope) params.set("collection_id", scope.collectionId);
  if (includeLibrary) params.set("library_id", String(libraryId));
  if (cursor) params.set("cursor", cursor);
  if (type) params.set("type", type.toLowerCase());
  if (namePrefix) params.set("name_prefix", namePrefix);
  if (!collectionOrder) params.set("sort", order === "desc" ? `-${sort}` : sort);

  const page = await requestV2<NativeCatalogPage>(session, `/catalog?${params}`);
  if (page.page?.has_more && !page.page.next_cursor) {
    throw new Error("Silo returned another library page without a continuation cursor.");
  }
  return {
    items: (page.items ?? []).map(toItem).filter((item) => item.Id),
    nextCursor: page.page?.has_more ? page.page.next_cursor : undefined
  };
}

export async function getCatalogFilterOptions(
  session: Session,
  libraryId: number | string,
  scope?: CatalogScope
): Promise<CatalogFilterOptions> {
  const params = new URLSearchParams({
    library_id: String(libraryId),
    skip_technical: "false"
  });
  if (scope) {
    params.set("source", scope.source);
    params.set("collection_id", scope.collectionId);
  }
  const response = await requestV2<{
    genres?: string[];
    studios?: string[];
    networks?: string[];
    countries?: string[];
    original_languages?: string[];
    content_ratings?: string[];
    authors?: string[];
    narrators?: string[];
    series?: string[];
    technical?: {
      resolutions?: string[];
      audio_languages?: string[];
      subtitle_languages?: string[];
    };
  }>(session, `/catalog/filters?${params}`);
  return {
    genres: response.genres ?? [],
    studios: response.studios ?? [],
    networks: response.networks ?? [],
    countries: response.countries ?? [],
    originalLanguages: response.original_languages ?? [],
    contentRatings: response.content_ratings ?? [],
    authors: response.authors ?? [],
    narrators: response.narrators ?? [],
    series: response.series ?? [],
    resolutions: response.technical?.resolutions ?? [],
    audioLanguages: response.technical?.audio_languages ?? [],
    subtitleLanguages: response.technical?.subtitle_languages ?? []
  };
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
  const data = await requestV2<NativeCollectionsResponse>(session, `/library/${libraryId}/collections`);
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
    limit: "100",
    skip_total: "true"
  });
  return unpack(await requestV2<NativeList>(session, `/catalog?${params}`)).Items;
}

export async function getFavorites(session: Session): Promise<SiloItem[]> {
  return unpack(await requestV2<NativeList>(session, "/favorites?limit=100")).Items;
}

export async function getWatchlist(session: Session): Promise<SiloItem[]> {
  return unpack(await requestV2<NativeList>(session, "/watchlist?limit=100")).Items;
}

async function personalItemExists(session: Session, kind: "favorites" | "watchlist", contentId: string) {
  try {
    await requestV2<unknown>(session, `/${kind}/${encodeURIComponent(contentId)}`);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`/${kind}/${encodeURIComponent(contentId)}: 404 `)) return false;
    throw error;
  }
}

export function isFavorite(session: Session, contentId: string) {
  return personalItemExists(session, "favorites", contentId);
}

export function isInWatchlist(session: Session, contentId: string) {
  return personalItemExists(session, "watchlist", contentId);
}

export async function setFavorite(session: Session, contentId: string, enabled: boolean) {
  await requestV2<void>(session, `/favorites/${encodeURIComponent(contentId)}`, { method: enabled ? "PUT" : "DELETE" });
}

export async function setWatchlist(session: Session, contentId: string, enabled: boolean) {
  await requestV2<void>(session, `/watchlist/${encodeURIComponent(contentId)}`, { method: enabled ? "PUT" : "DELETE" });
}

export async function searchItems(session: Session, query: string): Promise<SiloItem[]> {
  if (!query.trim()) return [];
  return unpack(await requestV2<NativeList>(session, catalogPath("all", 60, query.trim()))).Items;
}

export async function getCatalogItem(session: Session, contentId: string): Promise<SiloItem> {
  const data = await requestV2<NativeItem>(session, `/catalog/items/${encodeURIComponent(contentId)}`);
  return toItem(data);
}

export async function setWatched(session: Session, contentId: string, watched: boolean) {
  await requestV2<void>(session, `/watched/${encodeURIComponent(contentId)}`, { method: watched ? "POST" : "DELETE" });
}

export type NativeEventsTicket = { ticket: string; expires_in: number; max_connection_seconds: number; protocol: string };

export async function mintEventsTicket(session: Session): Promise<NativeEventsTicket> {
  return requestV2<NativeEventsTicket>(session, "/events/ws-ticket", { method: "POST" });
}

export function eventsSocketUrl(session: Session, channels: string[]): string {
  const base = normalizeServerUrl(session.serverUrl).replace(/^http/, "ws");
  const raw = `${base}/api/v2/events/ws?channels=${encodeURIComponent(channels.join(","))}`;
  return new URL(raw, window.location.href).toString().replace(/^http/, "ws");
}

export async function getSimilarItems(session: Session, contentId: string, limit = 12): Promise<SiloItem[]> {
  const data = await requestV2<NativeList>(session, `/recommendations/similar/${encodeURIComponent(contentId)}?limit=${limit}`);
  return unpack(data).Items.filter(item => item.Id && item.Id !== contentId);
}

export type DetailPerson = { name: string; role?: string; personId?: string; photoUrl?: string };
export type DetailTrailer = { key: string; title: string; kind: "youtube" | "local"; youtubeKey?: string; contentId?: string; fileId?: number; durationSeconds?: number; thumbnail?: string };
export type DetailExtras = {
  tagline?: string;
  cast: DetailPerson[];
  crew: DetailPerson[];
  studios: string[];
  networks: string[];
  countries: string[];
  showStatus?: string;
  originalLanguage?: string;
  trailers: DetailTrailer[];
  themes: ThemeSelection | null;
};

type NativeDetailExtras = {
  tagline?: string;
  cast?: Array<{ name: string; character?: string; order?: number; person_id?: string | number; photo_url?: string }>;
  crew?: Array<{ name: string; job?: string; person_id?: string | number; photo_url?: string }>;
  studios?: string[];
  networks?: string[];
  countries?: string[];
  show_status?: string;
  original_language?: string;
  themes?: { owner_id?: string; items?: Array<{ id: string }> };
  videos?: Array<{ site?: string; site_key?: string; name?: string; kind?: string }>;
  extras?: Array<{ content_id: string; kind?: string; title?: string; duration_seconds?: number; file_id?: number; still_url?: string }>;
};

export async function getDetailExtras(session: Session, contentId: string): Promise<DetailExtras> {
  const data = await requestV2<NativeDetailExtras>(session, `/catalog/items/${encodeURIComponent(contentId)}`);
  const trailers: DetailTrailer[] = [];
  const seen = new Set<string>();
  for (const extra of data.extras ?? []) {
    const key = `local:${extra.content_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trailers.push({ key, title: extra.title || extra.kind || "Extra", kind: "local", contentId: extra.content_id, fileId: extra.file_id, durationSeconds: extra.duration_seconds, thumbnail: assetUrl(session, extra.still_url) || undefined });
  }
  for (const video of data.videos ?? []) {
    if (video.site?.toLowerCase() !== "youtube" || !video.site_key?.trim()) continue;
    const key = `youtube:${video.site_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trailers.push({ key, title: video.name || video.kind || "Trailer", kind: "youtube", youtubeKey: video.site_key, thumbnail: `https://i.ytimg.com/vi/${video.site_key}/hqdefault.jpg` });
  }
  return {
    tagline: data.tagline,
    cast: [...(data.cast ?? [])].sort((l, r) => (l.order ?? 0) - (r.order ?? 0)).map(member => ({ name: member.name, role: member.character, personId: member.person_id == null ? undefined : String(member.person_id), photoUrl: assetUrl(session, member.photo_url) || undefined })),
    crew: (data.crew ?? []).map(member => ({ name: member.name, role: member.job, personId: member.person_id == null ? undefined : String(member.person_id), photoUrl: assetUrl(session, member.photo_url) || undefined })),
    studios: data.studios ?? [],
    networks: data.networks ?? [],
    countries: data.countries ?? [],
    showStatus: data.show_status,
    originalLanguage: data.original_language,
    trailers,
    themes: data.themes?.owner_id && data.themes.items?.length ? { ownerId: data.themes.owner_id, themes: data.themes.items.map(theme => ({ id: theme.id })) } : null
  };
}

export type PersonDetail = { id: string; name: string; bio?: string; birthDate?: string; deathDate?: string; birthplace?: string; photoUrl?: string };

export async function getPerson(session: Session, personId: string): Promise<PersonDetail> {
  const data = await requestV2<{ id: string | number; name: string; bio?: string; birth_date?: string; death_date?: string; birthplace?: string; photo_url?: string }>(session, `/catalog/people/${encodeURIComponent(personId)}`);
  return { id: String(data.id), name: data.name, bio: data.bio, birthDate: data.birth_date, deathDate: data.death_date, birthplace: data.birthplace, photoUrl: assetUrl(session, data.photo_url) || undefined };
}

export async function findPersonId(session: Session, name: string): Promise<string | undefined> {
  const data = await requestV2<{ items?: Array<{ id: string | number; name: string }> }>(session, `/catalog/people?q=${encodeURIComponent(name)}&limit=20`);
  const items = data.items ?? [];
  const match = items.find(person => person.name.toLowerCase() === name.toLowerCase()) ?? items[0];
  return match ? String(match.id) : undefined;
}

export async function getPersonFilmographyPage(session: Session, personId: string, cursor?: string): Promise<{ items: SiloItem[]; nextCursor?: string }> {
  const params = new URLSearchParams({ source: "person", person_id: personId, limit: "60" });
  if (cursor) params.set("cursor", cursor);
  const page = await requestV2<NativeCatalogPage>(session, `/catalog?${params}`);
  return {
    items: (page.items ?? []).map(toItem).filter(item => item.Id),
    nextCursor: page.page?.has_more ? page.page.next_cursor : undefined
  };
}

export type SiloAppearance = { theme: string; variables: Record<string, string>; textScale: string; textWeight: string; highContrast: boolean; posterSize: string };

export async function getProfileAppearance(session: Session): Promise<SiloAppearance> {
  const params = new URLSearchParams();
  ["ui.theme", "ui.custom_theme_vars", "ui.text_scale", "ui.text_weight", "ui.high_contrast", "ui.card_presentation"].forEach(key => params.append("keys", key));
  const data = await requestV2<{ items?: Array<{ key: string; value?: unknown }> }>(session, `/settings/values/effective?${params}`, { headers: { "X-Silo-Device-Id": getDeviceId() } });
  const values = new Map((data.items ?? []).map(entry => [entry.key, entry.value == null ? "" : typeof entry.value === "string" ? entry.value : typeof entry.value === "object" ? JSON.stringify(entry.value) : String(entry.value)]));
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
    highContrast: values.get("ui.high_contrast") === "true",
    posterSize: (() => { try { const value = JSON.parse(values.get("ui.card_presentation") || "{}"); return ["compact", "standard", "large"].includes(value.poster_size) ? value.poster_size : "standard"; } catch { return "standard"; } })()
  };
}

export async function getSeasons(session: Session, seriesId: string): Promise<SiloItem[]> {
  const data = await requestV2<{ items?: NativeItem[] }>(
    session,
    `/catalog/series/${encodeURIComponent(seriesId)}/seasons`
  );
  return (data.items ?? []).map((season) => toItem({ ...season, type: "season" }));
}

export async function getEpisodes(session: Session, seriesId: string, seasonNumber: number): Promise<SiloItem[]> {
  const data = await requestV2<{ items?: NativeItem[] }>(
    session,
    `/catalog/series/${encodeURIComponent(seriesId)}/seasons/${seasonNumber}/episodes`
  );
  return (data.items ?? []).map((episode) => toItem({ ...episode, type: "episode", series_id: seriesId }));
}

function assetUrl(session: Session, value?: string) {
  if (!value) return "";
  if (/^https?:\/\//.test(value)) return value;
  return `${normalizeServerUrl(session.serverUrl)}${value.startsWith("/") ? "" : "/"}${value}`;
}

export function imageUrl(session: Session, item: SiloItem | string): string {
  return typeof item === "string" ? "" : assetUrl(session, item.PosterUrl);
}

export function artUrl(session: Session, item: SiloItem): string {
  return assetUrl(session, item.Type === "Episode" ? item.PosterUrl ?? item.BackdropUrl : item.BackdropUrl ?? item.PosterUrl);
}

export function backdropUrl(session: Session, item: SiloItem | string): string {
  return typeof item === "string" ? "" : assetUrl(session, item.BackdropUrl ?? item.PosterUrl);
}

export function mediaLogoUrl(session: Session, item: SiloItem): string {
  return titleArtEnabled() ? assetUrl(session, item.LogoUrl) : "";
}

export function requestArtworkUrl(path?: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `https://image.tmdb.org/t/p/w780${path.startsWith("/") ? path : `/${path}`}`;
}

export type Shuffle = { id: string; scopeLabel?: string; current: SiloItem; next: SiloItem };

type NativeShuffle = { id?: string; scope?: { title?: string; parent_title?: string }; current?: NativeItem; next?: NativeItem };

function toShuffle(response: NativeShuffle): Shuffle {
  if (!response.id || !response.current || !response.next) throw new Error("The shuffle response has no pick.");
  const title = response.scope?.title?.trim();
  const parent = response.scope?.parent_title?.trim();
  return { id: response.id, scopeLabel: title ? (parent ? `${parent} · ${title}` : title) : undefined, current: toItem(response.current), next: toItem(response.next) };
}

export async function getShuffle(session: Session, shuffleId: string): Promise<Shuffle> {
  return toShuffle(await requestV2<NativeShuffle>(session, `/shuffles/${encodeURIComponent(shuffleId)}?image_size=large`));
}

export async function skipShuffle(session: Session, shuffleId: string, nextContentId: string): Promise<Shuffle> {
  return toShuffle(await requestV2<NativeShuffle>(session, `/shuffles/${encodeURIComponent(shuffleId)}/skip?image_size=large`, {
    method: "POST",
    body: JSON.stringify({ next_content_id: nextContentId })
  }));
}

export async function getShuffleCapability(session: Session): Promise<{ available: boolean; scopeKinds: string[] }> {
  const response = await requestV2<{ state?: string; allowed?: boolean; scope_kinds?: string[] }>(session, "/shuffles/capabilities");
  return {
    available: response.allowed === true && response.state === "available",
    scopeKinds: response.scope_kinds ?? []
  };
}

export async function createShuffle(session: Session, kind: string, id: string | number): Promise<Shuffle> {
  return toShuffle(await requestV2<NativeShuffle>(session, "/shuffles?image_size=large", {
    method: "POST",
    body: JSON.stringify({ scope: { kind, id: String(id) } })
  }));
}

export async function advanceShuffle(session: Session, shuffleId: string, fromContentId: string): Promise<Shuffle> {
  return toShuffle(await requestV2<NativeShuffle>(session, `/shuffles/${encodeURIComponent(shuffleId)}/advance?image_size=large`, {
    method: "POST",
    body: JSON.stringify({ from_content_id: fromContentId })
  }));
}

export async function deleteShuffle(session: Session, shuffleId: string): Promise<void> {
  await requestV2<unknown>(session, `/shuffles/${encodeURIComponent(shuffleId)}`, { method: "DELETE" });
}

export async function libraryHasItems(session: Session, libraryId: number | string, type?: string): Promise<boolean | null> {
  try {
    const params = new URLSearchParams({ source: "query", library_id: String(libraryId), limit: "1", skip_total: "true" });
    if (type) params.set("type", type.toLowerCase());
    const page = await requestV2<NativeCatalogPage>(session, `/catalog?${params}`);
    return (page.items ?? []).length > 0;
  } catch {
    return null;
  }
}

export type CollectionSection = { name: string; kind: "regular" | "user_collection"; collections: SiloCollection[] };

type NativeCollectionCard = { id: string | number; title?: string; poster_url?: string; item_count?: number };
type NativeLibraryCollectionTab = {
  collections?: NativeCollectionCard[];
  groups?: Array<{ name?: string; kind?: string; sort_order?: number; collections?: NativeCollectionCard[] }>;
  ungrouped?: { sort_order?: number; collections?: NativeCollectionCard[] };
};

export async function getLibraryCollectionSections(session: Session, libraryId: number | string): Promise<CollectionSection[]> {
  const tab = await requestV2<NativeLibraryCollectionTab>(session, `/library/${encodeURIComponent(String(libraryId))}/collections`);
  const card = (item: NativeCollectionCard, kind: SiloCollection["kind"]): SiloCollection => ({
    id: String(item.id),
    name: item.title ?? "Collection",
    itemCount: item.item_count,
    posterUrl: item.poster_url || undefined,
    kind
  });
  if (!tab.groups?.length && !tab.ungrouped) {
    const collections = (tab.collections ?? []).map(item => card(item, "regular"));
    return collections.length ? [{ name: "", kind: "regular", collections }] : [];
  }
  const ranked: Array<{ order: number; section: CollectionSection }> = [];
  for (const group of tab.groups ?? []) {
    const kind = group.kind === "user_collections" ? "user_collection" : "regular";
    const collections = (group.collections ?? []).map(item => card(item, kind));
    if (collections.length) ranked.push({ order: group.sort_order ?? 0, section: { name: group.name ?? "", kind, collections } });
  }
  const loose = (tab.ungrouped?.collections ?? []).map(item => card(item, "regular"));
  if (loose.length) ranked.push({ order: tab.ungrouped?.sort_order ?? 0, section: { name: "", kind: "regular", collections: loose } });
  return ranked.sort((a, b) => a.order - b.order).map(entry => entry.section);
}

export type AudiobookGroup = {
  name: string;
  itemCount: number;
  durationSeconds?: number;
  inProgressCount: number;
  posterUrls: string[];
};

export async function getAudiobookGroupsPage(
  session: Session,
  libraryId: number | string,
  groupBy: "author" | "series",
  cursor?: string
): Promise<{ groups: AudiobookGroup[]; nextCursor?: string }> {
  const params = new URLSearchParams({
    library_id: String(libraryId),
    group_by: groupBy,
    sort: "name",
    limit: "100",
    skip_total: "false"
  });
  if (cursor) params.set("cursor", cursor);
  const page = await requestV2<{
    items?: Array<{ name?: string; item_count?: number; total_duration_seconds?: number; in_progress_count?: number; poster_urls?: string[] }>;
    page?: { has_more?: boolean; next_cursor?: string };
  }>(session, `/catalog/audiobook-groups?${params}`);
  if (page.page?.has_more && !page.page.next_cursor) {
    throw new Error("Silo returned another group page without a continuation cursor.");
  }
  return {
    groups: (page.items ?? []).filter(item => item.name).map(item => ({
      name: item.name as string,
      itemCount: item.item_count ?? 0,
      durationSeconds: item.total_duration_seconds,
      inProgressCount: item.in_progress_count ?? 0,
      posterUrls: item.poster_urls ?? []
    })),
    nextCursor: page.page?.has_more ? page.page.next_cursor : undefined
  };
}
