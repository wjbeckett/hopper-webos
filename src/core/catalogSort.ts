/**
 * The library sort list (#174): the web client's options, names, order and default directions
 * (silo-server `web/src/lib/querySortOptions.ts`), with Android TV's rules for which a list shows
 * (`CatalogSort.kt`, silo-android #843).
 */
export type SortScope = "movie" | "series" | "episode" | "audiobook";
/** Which fields a list offers: every one, those ordering movies, series and episodes alike, or one scope. */
export type SortRelevance = { kind: "any" } | { kind: "allVideo" } | { kind: "only"; scope: SortScope };
type DirectionStyle = "alphabetical" | "chronological" | "length" | "magnitude" | "count";

export type SortField = {
  id: string;
  label: string;
  order: "asc" | "desc";
  /** Ordered by this profile's own watching. */
  personalized: boolean;
  scopes: SortScope[];
  style: DirectionStyle;
  /** Offered only while the server shows this rating source. */
  ratingSource?: string;
};

const VIDEO: SortScope[] = ["movie", "series", "episode"];
const MEDIA: SortScope[] = [...VIDEO, "audiobook"];

export const SORT_FIELDS: SortField[] = [
  { id: "title", label: "Title", order: "asc", personalized: false, scopes: MEDIA, style: "alphabetical" },
  { id: "added_at", label: "Date Added", order: "desc", personalized: false, scopes: MEDIA, style: "chronological" },
  { id: "release_date", label: "Release Date", order: "desc", personalized: false, scopes: MEDIA, style: "chronological" },
  { id: "last_air_date", label: "Latest Episode Air Date", order: "desc", personalized: false, scopes: ["series", "episode"], style: "chronological" },
  { id: "latest_episode_added", label: "Latest Episode Added", order: "desc", personalized: false, scopes: ["series"], style: "chronological" },
  { id: "year", label: "Year", order: "desc", personalized: false, scopes: MEDIA, style: "chronological" },
  { id: "content_rating", label: "Content Rating", order: "asc", personalized: false, scopes: VIDEO, style: "alphabetical" },
  { id: "runtime", label: "Duration", order: "desc", personalized: false, scopes: MEDIA, style: "length" },
  { id: "rating_imdb", label: "IMDb Rating", order: "desc", personalized: false, scopes: VIDEO, style: "magnitude" },
  { id: "rating_tmdb", label: "TMDB Rating", order: "desc", personalized: false, scopes: VIDEO, style: "magnitude" },
  { id: "rating_rt_critic", label: "RT Critic Rating", order: "desc", personalized: false, scopes: VIDEO, style: "magnitude", ratingSource: "rt_critic" },
  { id: "rating_rt_audience", label: "RT Audience Rating", order: "desc", personalized: false, scopes: VIDEO, style: "magnitude", ratingSource: "rt_audience" },
  { id: "resolution", label: "Resolution", order: "desc", personalized: false, scopes: VIDEO, style: "magnitude" },
  { id: "bitrate", label: "Bitrate", order: "desc", personalized: false, scopes: MEDIA, style: "magnitude" },
  { id: "progress", label: "Progress", order: "desc", personalized: true, scopes: MEDIA, style: "magnitude" },
  { id: "date_viewed", label: "Date Viewed", order: "desc", personalized: true, scopes: MEDIA, style: "chronological" },
  { id: "plays", label: "Plays", order: "desc", personalized: true, scopes: MEDIA, style: "count" },
  { id: "author", label: "Author", order: "asc", personalized: false, scopes: ["audiobook"], style: "alphabetical" },
  { id: "narrator", label: "Narrator", order: "asc", personalized: false, scopes: ["audiobook"], style: "alphabetical" },
  { id: "series", label: "Series", order: "asc", personalized: false, scopes: ["audiobook"], style: "alphabetical" }
];

/** The relevance for libraries of these types; `mediaType` is the Movie/Series side a mixed library shows. */
export function sortRelevance(libraryTypes: string[], mediaType?: string): SortRelevance {
  const scopes = new Set(libraryTypes.map(type => {
    const kind = type.trim().toLowerCase();
    if (["movie", "movies", "film"].includes(kind)) return "movie";
    if (["series", "show", "shows", "tv"].includes(kind)) return "series";
    if (/audio.?book/.test(kind)) return "audiobook";
    return "mixed";
  }));
  if (scopes.size === 1) {
    const [only] = scopes;
    if (only !== "mixed") return { kind: "only", scope: only as SortScope };
  }
  if (scopes.size === 0 || scopes.size > 1 && !scopes.has("mixed") && scopes.has("audiobook")) return { kind: "any" };
  const side = mediaType?.trim().toLowerCase();
  if (side === "movie") return { kind: "only", scope: "movie" };
  if (side === "series") return { kind: "only", scope: "series" };
  return { kind: "allVideo" };
}

const applies = (field: SortField, relevance: SortRelevance) =>
  relevance.kind === "any" ? true
    : relevance.kind === "allVideo" ? VIDEO.every(scope => field.scopes.includes(scope))
      : field.scopes.includes(relevance.scope);

/**
 * The fields a list offers, in the web's order. A rating sort whose source the server doesn't
 * show is left out (`shownRatingSources` null: not known yet, so RT sorts wait). `keep`, the
 * sort in use, is always listed, so a restored sort the list wouldn't otherwise offer stays
 * visible and can be changed.
 */
export function sortOptions(relevance: SortRelevance, options: { includePersonalized: boolean; shownRatingSources: ReadonlySet<string> | null; keep?: string }): SortField[] {
  return SORT_FIELDS.filter(field => field.id === options.keep || (
    (options.includePersonalized || !field.personalized)
    && applies(field, relevance)
    && (!field.ratingSource || options.shownRatingSources?.has(field.ratingSource) === true)
  ));
}

/** The direction names: "A–Z", "Newest", "Longest" and so on. */
export function sortDirectionLabel(id: string, order: "asc" | "desc") {
  if (id === "collection") return "Default";
  const style = SORT_FIELDS.find(field => field.id === id)?.style ?? "magnitude";
  switch (style) {
    case "alphabetical": return order === "asc" ? "A–Z" : "Z–A";
    case "chronological": return order === "asc" ? "Oldest" : "Newest";
    case "length": return order === "asc" ? "Shortest" : "Longest";
    case "count": return order === "asc" ? "Fewest" : "Most";
    default: return order === "asc" ? "Lowest" : "Highest";
  }
}
