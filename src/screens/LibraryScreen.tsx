import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCatalogFilterOptions, getLibraryItemsPage, getShuffleCapability, imageUrl, libraryHasItems } from "../api/silo";
import type { CatalogFilterOptions, CatalogQueryGroup, CatalogScope } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { browsePrefsKey, readBrowsePrefs, readPreserve, writeBrowsePrefs, writePreserve } from "../core/browsePrefs";
import { LibraryBrowsePanels } from "./LibraryBrowsePanels";
import type { BrowseSortKey, BrowseSortOption } from "./LibraryBrowsePanels";
import { attemptFirstContentFocus, focusFirstContentCard, focusNavigationTarget } from "../navigation/spatial";
import type { Session, SiloItem, SiloLibrary } from "../types";
import { LoadingState } from "../components/LoadingState";

type BrowseSort = BrowseSortKey;
type SortOrder = "asc" | "desc";
type BrowsePanel = "sort" | "filter" | null;
type FilterSelection = Record<string, string[]>;
type SortOption = BrowseSortOption;

const videoSortOptions: SortOption[] = [
  { id: "title", label: "Title", order: "asc" },
  { id: "added_at", label: "Date Added", order: "desc" },
  { id: "release_date", label: "Release Date", order: "desc" },
  { id: "year", label: "Year", order: "desc" },
  { id: "rating_imdb", label: "Rating", order: "desc" },
  { id: "runtime", label: "Runtime", order: "desc" },
  { id: "resolution", label: "Resolution", order: "desc" }
];
const audiobookSortOptions: SortOption[] = [
  { id: "title", label: "Title", order: "asc" },
  { id: "author", label: "Author", order: "asc" },
  { id: "narrator", label: "Narrator", order: "asc" },
  { id: "series", label: "Series", order: "asc" },
  { id: "added_at", label: "Date Added", order: "desc" },
  { id: "runtime", label: "Runtime", order: "desc" }
];

const shuffleLibraryTypes = ["movie", "movies", "series", "show", "shows", "tv", "mixed"];

function isAudiobookLibrary(library: SiloLibrary) {
  return /audio.?book/i.test(library.type);
}

function getSortOptions(libraries: SiloLibrary[]): SortOption[] {
  if (libraries.length && libraries.every(isAudiobookLibrary)) return audiobookSortOptions;
  if (libraries.some(isAudiobookLibrary)) {
    return [...videoSortOptions, ...audiobookSortOptions.filter(option => !videoSortOptions.some(video => video.id === option.id))];
  }
  return videoSortOptions;
}

function restoreBrowsePrefs(key: string | null, libraries: SiloLibrary[]) {
  const saved = readBrowsePrefs(key);
  return saved && getSortOptions(libraries).some(option => option.id === saved.sort) ? saved : null;
}

function sortDirectionLabel(sort: BrowseSort, order: SortOrder) {
  if (sort === "collection") return "Default";
  if (["title", "author", "narrator", "series"].includes(sort)) return order === "asc" ? "A–Z" : "Z–A";
  if (["release_date", "year", "added_at"].includes(sort)) return order === "asc" ? "Oldest" : "Newest";
  if (sort === "runtime") return order === "asc" ? "Shortest" : "Longest";
  return order === "asc" ? "Lowest" : "Highest";
}

function buildFilterGroups(selection: FilterSelection): CatalogQueryGroup[] {
  const groups: CatalogQueryGroup[] = [];
  const valueFacets: Array<[string, string, string]> = [
    ["genre", "genre", "contains"],
    ["studio", "studio", "is"],
    ["network", "network", "is"],
    ["country", "country", "is"],
    ["content_rating", "content_rating", "is"],
    ["resolution", "resolution", "is"],
    ["audio_language", "audio_language", "is"],
    ["subtitle_language", "subtitle_language", "is"],
    ["original_language", "original_language", "is"],
    ["author", "author", "is"],
    ["narrator", "narrator", "is"],
    ["series", "series", "is"]
  ];
  for (const [facet, field, op] of valueFacets) {
    const values = selection[facet] ?? [];
    if (values.length) {
      groups.push({
        match: "any",
        rules: values.map(value => ({ field, op, value }))
      });
    }
  }

  const selectedDecades = selection.decade ?? [];
  if (selectedDecades.length) {
    groups.push({
      match: "any",
      rules: selectedDecades.map(year => ({
        field: "year",
        op: "between",
        value: [year, String(Number(year) + 9)]
      }))
    });
  }

  const selectedRanges = selection.dynamic_range ?? [];
  if (selectedRanges.length) {
    groups.push({
      match: "any",
      rules: selectedRanges.map(value => ({
        field: value === "hdr" ? "hdr" : "dolby_vision",
        op: "is",
        value: "true"
      }))
    });
  }

  const watchStatus = selection.watch_status?.[0];
  if (watchStatus) {
    const field = watchStatus === "unwatched" ? "watched"
      : watchStatus === "in_progress" ? "in_progress"
        : watchStatus === "watched" ? "watched"
          : watchStatus === "favorited" ? "favorited"
            : "in_watchlist";
    groups.push({
      match: "all",
      rules: [{ field, op: "is", value: watchStatus === "unwatched" ? "false" : "true" }]
    });
  }
  return groups;
}

function sortItems(items: SiloItem[], sort: BrowseSort, order: SortOrder) {
  if (sort === "collection") return [...items];
  return [...items].sort((a, b) => compareItems(a, b, sort, order));
}

function compareItems(a: SiloItem, b: SiloItem, sort: BrowseSort, order: SortOrder) {
  const textCompare = (left: string | undefined, right: string | undefined) =>
    (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
  if (sort === "collection") return 0;
  let comparison = 0;
  if (sort === "title") comparison = textCompare(a.Name, b.Name);
  else if (sort === "added_at") comparison = textCompare(a.DateAdded, b.DateAdded);
  else if (sort === "release_date") comparison = textCompare(a.ReleaseDate, b.ReleaseDate);
  else if (sort === "year") comparison = (a.ProductionYear ?? 0) - (b.ProductionYear ?? 0);
  else if (sort === "rating_imdb") comparison = (a.ImdbRating ?? a.TmdbRating ?? 0) - (b.ImdbRating ?? b.TmdbRating ?? 0);
  else if (sort === "runtime") comparison = (a.RuntimeMinutes ?? 0) - (b.RuntimeMinutes ?? 0);
  else if (sort === "resolution") comparison = textCompare(a.Resolution, b.Resolution);
  else if (sort === "author") comparison = textCompare(a.Author, b.Author);
  else if (sort === "narrator") comparison = textCompare(a.Narrator, b.Narrator);
  else comparison = textCompare(a.SeriesName, b.SeriesName);
  comparison ||= textCompare(a.Name, b.Name);
  return order === "desc" ? -comparison : comparison;
}

function sortedSafePrefix(
  streams: Record<string, SiloItem[]>,
  cursors: Record<string, string | null>,
  sort: BrowseSort,
  order: SortOrder,
  accepts: (item: SiloItem) => boolean,
  previousItems: SiloItem[] = []
) {
  const activeStreams = Object.entries(cursors)
    .filter(([, cursor]) => Boolean(cursor))
    .map(([key]) => streams[key] ?? []);
  if (activeStreams.some(items => items.length === 0)) return [];
  const boundary = activeStreams.reduce<SiloItem | null>((earliest, items) => {
    const lastItem = items[items.length - 1];
    if (!lastItem) return earliest;
    return !earliest || compareItems(lastItem, earliest, sort, order) < 0 ? lastItem : earliest;
  }, null);
  const ordered = sortItems(Object.values(streams).flat(), sort, order);
  const uniqueItems = new Map<string, SiloItem>();
  for (const item of ordered) {
    if (boundary && compareItems(item, boundary, sort, order) > 0) continue;
    if (accepts(item) && !uniqueItems.has(item.Id)) uniqueItems.set(item.Id, item);
  }
  const safeItems = Array.from(uniqueItems.values());
  const previousIds = new Set(previousItems.map(item => item.Id));
  const stablePrefix = previousItems.filter(item => uniqueItems.has(item.Id));
  return [...stablePrefix, ...safeItems.filter(item => !previousIds.has(item.Id))];
}

const browseReturnTargets = new Map<string, string>();

export function LibraryScreen({
  session,
  libraries,
  selectableLibraries = false,
  itemTypes,
  onOpen,
  onShuffle,
  collection,
  presetGroups,
  presetKey,
  header,
  hideControls = false
}: {
  session: Session;
  libraries: SiloLibrary[];
  selectableLibraries?: boolean;
  itemTypes?: string[];
  onOpen: (item: SiloItem) => void;
  onShuffle: (kind: string, id: string | number) => Promise<void>;
  collection?: { id: string; name: string; source: CatalogScope["source"] };
  presetGroups?: CatalogQueryGroup[];
  presetKey?: string;
  header?: ReactNode;
  hideControls?: boolean;
}) {
  const catalogScope = useMemo<CatalogScope | undefined>(
    () => collection ? { source: collection.source, collectionId: collection.id } : undefined,
    [collection?.id, collection?.source]
  );
  const defaultSort: BrowseSort = collection ? "collection" : "title";
  const persistsPrefs = !collection && !presetKey;
  const [browseItems, setBrowseItems] = useState<SiloItem[]>([]);
  const [browseCursors, setBrowseCursors] = useState<Record<string, string | null>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialPrefs] = useState(() => persistsPrefs ? restoreBrowsePrefs(
    browsePrefsKey(session, libraries.map(library => library.id).join(","), itemTypes?.length === 1 ? itemTypes[0] : undefined),
    libraries
  ) : null);
  const [sort, setSort] = useState<BrowseSort>((initialPrefs?.sort as BrowseSort | undefined) ?? defaultSort);
  const [order, setOrder] = useState<SortOrder>(initialPrefs?.order ?? "asc");
  const [filters, setFilters] = useState<FilterSelection>(initialPrefs?.filters ?? {});
  const [matchAll, setMatchAll] = useState(initialPrefs?.matchAll ?? true);
  const [filterOptions, setFilterOptions] = useState<CatalogFilterOptions>({
    genres: [], studios: [], networks: [], countries: [], originalLanguages: [],
    contentRatings: [], authors: [], narrators: [], series: [], resolutions: [],
    audioLanguages: [], subtitleLanguages: []
  });
  const [filterOptionsError, setFilterOptionsError] = useState("");
  const [shuffleError, setShuffleError] = useState("");
  const [shuffleSupported, setShuffleSupported] = useState(false);
  const [libraryEmpty, setLibraryEmpty] = useState<boolean | null>(null);
  const [namePrefix, setNamePrefix] = useState<string | null>(null);
  const pendingLetterFocusRef = useRef(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const browseSentinel = useRef<HTMLDivElement>(null);
  const [openPanel, setOpenPanel] = useState<BrowsePanel>(null);
  const loadingMoreRef = useRef(false);
  const failedBrowsePage = useRef(false);
  const browseItemsRef = useRef<SiloItem[]>([]);
  const browseCursorsRef = useRef<Record<string, string | null>>({});
  const browseStreamsRef = useRef<Record<string, SiloItem[]>>({});
  const pendingDownFocusRef = useRef<{ loadedCount: number; column: number } | null>(null);
  const initialLoadCompleteRef = useRef(false);
  const mountedRef = useRef("");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<number[]>(libraries.map(library => library.id));
  const resultsRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const activeLibraries = selectableLibraries ? libraries.filter(library => selectedLibraryIds.includes(library.id)) : libraries;
  const accepts = (item: SiloItem) => !itemTypes?.length || itemTypes.includes(item.Type ?? "");
  const availableSortOptions = useMemo(
    () => collection
      ? [{ id: "collection" as const, label: "Collection Order", order: "asc" as const }, ...getSortOptions(activeLibraries)]
      : getSortOptions(activeLibraries),
    [activeLibraries, collection]
  );
  const catalogGroups = useMemo(() => buildFilterGroups(filters), [filters]);
  const requestGroups = useMemo(() => presetGroups?.length ? [...presetGroups, ...catalogGroups] : catalogGroups, [presetGroups, catalogGroups]);
  const filterGroupsKey = JSON.stringify(requestGroups);
  const browseLibraryKey = activeLibraries.map(library => String(library.id)).join(",");
  const itemTypesKey = itemTypes?.join(",") ?? "";
  const browseType = itemTypes?.length === 1 ? itemTypes[0] : undefined;
  const browseTypeKey = browseType ?? "";
  const browseRequestKey = `${session.serverUrl}|${session.profileId ?? ""}|${browseLibraryKey}|${browseTypeKey}|${sort}|${order}|${filterGroupsKey}|${matchAll}|${namePrefix ?? ""}|${reloadNonce}|${collection?.id ?? ""}|${presetKey ?? ""}`;
  const prefsKey = persistsPrefs ? browsePrefsKey(session, browseLibraryKey, browseType) : null;
  const [appliedPrefsKey, setAppliedPrefsKey] = useState(prefsKey);
  const [preserve, setPreserve] = useState(() => readPreserve(prefsKey));
  if (appliedPrefsKey !== prefsKey) {
    const saved = restoreBrowsePrefs(prefsKey, activeLibraries);
    setAppliedPrefsKey(prefsKey);
    setSort((saved?.sort as BrowseSort | undefined) ?? defaultSort);
    setOrder(saved?.order ?? "asc");
    setFilters(saved?.filters ?? {});
    setMatchAll(saved?.matchAll ?? true);
    setNamePrefix(null);
    setPreserve(readPreserve(prefsKey));
  }
  const currentBrowseRequest = useRef("");
  const hasMoreBrowseItems = Object.values(browseCursors).some(Boolean);
  const cursorKey = (libraryId: string, prefix: string) => `${libraryId}::${prefix}`;
  const visibleItems = browseItems;

  useEffect(() => {
    if (preserve) writeBrowsePrefs(prefsKey, { sort, order, filters, matchAll });
  }, [preserve, prefsKey, sort, order, filters, matchAll]);

  const returnTargetRef = useRef<string | undefined>(undefined);
  const returnLoadsRef = useRef(0);
  const surfaceKey = `${session.serverUrl}|${session.profileId ?? ""}|${browseLibraryKey}|${browseTypeKey}|${collection?.id ?? ""}|${presetKey ?? ""}`;
  if (mountedRef.current !== surfaceKey) {
    mountedRef.current = surfaceKey;
    initialLoadCompleteRef.current = false;
    returnTargetRef.current = undefined;
  }
  if (!initialLoadCompleteRef.current && returnTargetRef.current === undefined) {
    returnTargetRef.current = browseReturnTargets.get(surfaceKey) ?? "";
    browseReturnTargets.delete(surfaceKey);
  }

  useEffect(() => {
    if (loading || !browseItems.length || initialLoadCompleteRef.current) return;
    const targetId = returnTargetRef.current;
    if (targetId && !browseItems.some(item => item.Id === targetId)) {
      if (loadingMore) return;
      if (hasMoreBrowseItems && returnLoadsRef.current < 4 && !failedBrowsePage.current) {
        returnLoadsRef.current += 1;
        void loadMoreBrowseItems(true);
        return;
      }
    }
    initialLoadCompleteRef.current = true;
    requestAnimationFrame(() => {
      const card = targetId
        ? Array.from(document.querySelectorAll<HTMLElement>(".library-results [data-media-id]")).find(element => element.dataset.mediaId === targetId)
        : undefined;
      if (card) {
        card.scrollIntoView({ block: "center" });
        focusNavigationTarget(card);
      } else attemptFirstContentFocus(120);
    });
  }, [loading, loadingMore, browseItems, hasMoreBrowseItems]);

  useEffect(() => {
    setSelectedLibraryIds(current =>
      current.length
        ? current.filter(id => libraries.some(library => library.id === id))
        : libraries.map(library => library.id)
    );
  }, [libraries]);

  useEffect(() => {
    let alive = true;
    setFilterOptionsError("");
    const libraryIds = browseLibraryKey ? browseLibraryKey.split(",") : [];
    if (!libraryIds.length) {
      setFilterOptions({
        genres: [], studios: [], networks: [], countries: [], originalLanguages: [],
        contentRatings: [], authors: [], narrators: [], series: [], resolutions: [],
        audioLanguages: [], subtitleLanguages: []
      });
      return () => { alive = false; };
    }
    Promise.all(libraryIds.map(id => getCatalogFilterOptions(session, id, catalogScope)))
      .then(results => {
        if (!alive) return;
        const merge = (key: keyof CatalogFilterOptions) => [...new Set(results.flatMap(result => result[key]))];
        setFilterOptions({
          genres: merge("genres"),
          studios: merge("studios"),
          networks: merge("networks"),
          countries: merge("countries"),
          originalLanguages: merge("originalLanguages"),
          contentRatings: merge("contentRatings"),
          authors: merge("authors"),
          narrators: merge("narrators"),
          series: merge("series"),
          resolutions: merge("resolutions"),
          audioLanguages: merge("audioLanguages"),
          subtitleLanguages: merge("subtitleLanguages")
        });
      })
      .catch(cause => {
        if (alive) setFilterOptionsError(cause instanceof Error ? cause.message : "Could not load catalog filter options.");
      });
    return () => { alive = false; };
  }, [browseLibraryKey, session, catalogScope]);

  useEffect(() => {
    let alive = true;
    currentBrowseRequest.current = browseRequestKey;
    setLoading(true);
    setLoadingMore(false);
    setError("");
    pendingDownFocusRef.current = null;
    resultsRef.current?.scrollTo?.(0, 0);
    browseItemsRef.current = [];
    browseCursorsRef.current = {};
    browseStreamsRef.current = {};
    setBrowseItems([]);
    setBrowseCursors({});
    failedBrowsePage.current = false;
    const libraryIds = browseLibraryKey ? browseLibraryKey.split(",") : [];
    Promise.all(libraryIds.map(async id => ({
      key: cursorKey(id, ""),
      page: await getLibraryItemsPage(session, id, undefined, browseType, 100, sort, order, requestGroups, matchAll ? "all" : "any", namePrefix ?? undefined, catalogScope)
    })))
      .then((pages) => {
        if (!alive) return;
        const streams = Object.fromEntries(pages.map(({ key, page }) => [key, page.items]));
        const cursors = Object.fromEntries(pages.map(({ key, page }) => [key, page.nextCursor ?? null]));
        const items = sortedSafePrefix(streams, cursors, sort, order, accepts);
        browseStreamsRef.current = streams;
        browseItemsRef.current = items;
        browseCursorsRef.current = cursors;
        setBrowseItems(items);
        setBrowseCursors(cursors);
        if (items.length || Object.values(cursors).some(Boolean)) {
          setLibraryEmpty(false);
        } else if (!requestGroups.length && !namePrefix) {
          setLibraryEmpty(true);
        } else {
          void Promise.all(libraryIds.map(id => libraryHasItems(session, id, browseType))).then(results => {
            if (alive) setLibraryEmpty(results.some(result => result === true) ? false : results.every(result => result === false));
          });
        }
      })
      .catch((err) => { if (alive) { setError(err instanceof Error ? err.message : "Library failed"); pendingLetterFocusRef.current = false; } })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [session, browseLibraryKey, browseTypeKey, itemTypesKey, sort, order, filterGroupsKey, matchAll, namePrefix, reloadNonce]);

  const loadMoreBrowseItems = useCallback(async (retry = false) => {
    if (loadingMoreRef.current) return;
    if (failedBrowsePage.current && !retry) return;
    loadingMoreRef.current = true;
    failedBrowsePage.current = false;
    setLoadingMore(true);
    try {
      const startingCount = browseItemsRef.current.length;
      const shouldLoadMore = () =>
        browseItemsRef.current.length < startingCount + 100 && Object.values(browseCursorsRef.current).some(Boolean);

      while (shouldLoadMore()) {
        const activeCursors = Object.entries(browseCursorsRef.current)
          .filter((entry): entry is [string, string] => Boolean(entry[1]));
        if (!activeCursors.length) break;
        const emptyStream = activeCursors.find(([key]) => !(browseStreamsRef.current[key] ?? []).length);
        const [key, cursor] = emptyStream ?? activeCursors.reduce((earliest, candidate) => {
          const candidateItems = browseStreamsRef.current[candidate[0]] ?? [];
          const earliestItems = browseStreamsRef.current[earliest[0]] ?? [];
          const candidateLast = candidateItems[candidateItems.length - 1];
          const earliestLast = earliestItems[earliestItems.length - 1];
          if (!candidateLast) return candidate;
          if (!earliestLast) return earliest;
          return compareItems(candidateLast, earliestLast, sort, order) < 0 ? candidate : earliest;
        });
        const [id] = key.split("::");
        const page = await getLibraryItemsPage(session, id, cursor, browseType, 100, sort, order, requestGroups, matchAll ? "all" : "any", namePrefix ?? undefined, catalogScope);
        if (currentBrowseRequest.current !== browseRequestKey) return;
        const streams = {
          ...browseStreamsRef.current,
          [key]: [...(browseStreamsRef.current[key] ?? []), ...page.items]
        };
        const cursors = { ...browseCursorsRef.current, [key]: page.nextCursor ?? null };
        const previousItems = browseItemsRef.current;
        const merged = sortedSafePrefix(streams, cursors, sort, order, accepts, previousItems);
        const prefixIsStable = previousItems.every((item, index) => merged[index]?.Id === item.Id);
        const known = new Set(previousItems.map(item => item.Id));
        const appended = prefixIsStable ? merged.filter(item => !known.has(item.Id))
          : Object.keys(streams).sort().flatMap(key => streams[key] ?? []).filter(item => !known.has(item.Id));
        const items = prefixIsStable ? merged : [...previousItems, ...appended];
        browseStreamsRef.current = streams;
        browseCursorsRef.current = cursors;
        browseItemsRef.current = items;
        setBrowseItems(items);
        setBrowseCursors(cursors);
      }
      setError("");
    } catch (err) {
      if (currentBrowseRequest.current === browseRequestKey) {
        failedBrowsePage.current = true;
        setError(err instanceof Error ? err.message : "Could not load more library items");
      }
    } finally {
      loadingMoreRef.current = false;
      if (currentBrowseRequest.current === browseRequestKey) setLoadingMore(false);
    }
  }, [browseRequestKey, browseType, itemTypesKey, session, sort, order, filterGroupsKey, matchAll, namePrefix]);

  useLayoutEffect(() => {
    const pending = pendingDownFocusRef.current;
    if (!pending) return;
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".library-results .library-grid [data-media-id]"));
    if (cards.length > pending.loadedCount) {
      const target = cards[Math.min(pending.loadedCount + pending.column, cards.length - 1)];
      pendingDownFocusRef.current = null;
      if (target) focusNavigationTarget(target);
    } else if (!loadingMore && !hasMoreBrowseItems) {
      pendingDownFocusRef.current = null;
    }
  }, [browseItems, visibleItems, loadingMore, hasMoreBrowseItems]);

  useEffect(() => {
    if (!pendingLetterFocusRef.current || loading || error) return;
    if (!browseItems.length) {
      pendingLetterFocusRef.current = false;
      return;
    }
    if (returnTargetRef.current) return;
    pendingLetterFocusRef.current = false;
    focusFirstContentCard();
  }, [browseItems, loading, error]);

  useEffect(() => {
    const onBack = (event: Event) => {
      if (!namePrefix) return;
      setNamePrefix(null);
      pendingLetterFocusRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".library-alpha-nav .library-alpha-button")?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("silo:library-back", onBack);
    return () => window.removeEventListener("silo:library-back", onBack);
  }, [namePrefix]);

  useEffect(() => {
    const loadAtGridEdge = (event: Event) => {
      const customEvent = event as CustomEvent<{ loadedCount: number; column: number }>;
      if (!hasMoreBrowseItems || !customEvent.detail) return;
      pendingDownFocusRef.current ??= customEvent.detail;
      void loadMoreBrowseItems(true);
    };
    window.addEventListener("silo:library-load-more", loadAtGridEdge);
    return () => window.removeEventListener("silo:library-load-more", loadAtGridEdge);
  }, [hasMoreBrowseItems, loadMoreBrowseItems]);

  useEffect(() => {
    if (loading || !hasMoreBrowseItems) return;
    const sentinel = browseSentinel.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreBrowseItems();
    }, { root: sentinel.closest(".library-results"), rootMargin: "1600px 0px" });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, hasMoreBrowseItems, browseCursors, loadMoreBrowseItems]);

  const shuffleTarget = useMemo<{ kind: string; id: string | number } | undefined>(() => {
    if (collection) return browseType ? undefined : { kind: collection.source, id: collection.id };
    if (activeLibraries.length !== 1) return undefined;
    const type = activeLibraries[0].type.trim().toLowerCase();
    if (!shuffleLibraryTypes.includes(type) || (itemTypes?.length && type === "mixed") || presetKey) return undefined;
    return { kind: "library", id: activeLibraries[0].id };
  }, [collection, browseType, activeLibraries, itemTypes, presetKey]);
  const shuffleKind = shuffleTarget?.kind;

  useEffect(() => {
    if (!shuffleKind) {
      setShuffleSupported(false);
      return;
    }
    let alive = true;
    getShuffleCapability(session)
      .then(result => { if (alive) setShuffleSupported(result.available && result.scopeKinds.includes(shuffleKind)); })
      .catch(() => { if (alive) setShuffleSupported(false); });
    return () => { alive = false; };
  }, [session, shuffleKind]);

  async function shuffle() {
    if (!shuffleTarget) return;
    setShuffleError("");
    try {
      await onShuffle(shuffleTarget.kind, shuffleTarget.id);
    } catch (cause) {
      setShuffleError(cause instanceof Error ? cause.message : "Could not start shuffle playback.");
    }
  }

  function clearFilters() {
    setFilters({});
    setMatchAll(true);
    setNamePrefix(null);
  }

  useEffect(() => {
    if (!loading && error && !browseItems.length) {
      const frame = requestAnimationFrame(() => retryRef.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
  }, [loading, error, browseItems.length]);

  const closeBrowsePanel = useCallback(() => {
    const closingPanel = openPanel;
    setOpenPanel(null);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-browse-open="${closingPanel ?? "filter"}"]`)?.focus({ preventScroll: true });
    });
  }, [openPanel]);

  const showAlphaRail = sort === "title" && !collection;

  return (
    <main className={`content-screen library-screen ${showAlphaRail ? "has-alpha-rail" : ""}`}>
      <div className="library-main">
        <div ref={resultsRef} className="library-results" data-has-more={hasMoreBrowseItems}>
          <div className="library-controls">
            {header}
            {hideControls ? null : <div className="browse-toolbar">
              <button
                type="button"
                data-tv-focusable="true"
                data-browse-dropdown-trigger="sort"
                data-browse-open="sort"
                className="browse-dropdown-trigger"
                aria-haspopup="dialog"
                onClick={() => setOpenPanel("sort")}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                  <path d="M8 3v18m0 0-4-4m4 4 4-4M16 21V3m0 0-4 4m4-4 4 4" />
                </svg>
                <span>Sort · {availableSortOptions.find(option => option.id === sort)?.label ?? "Title"}</span>
                <span className="browse-control-direction">{sortDirectionLabel(sort, order)}</span>
              </button>
              <button
                type="button"
                data-tv-focusable="true"
                data-browse-dropdown-trigger="filter"
                data-browse-open="filter"
                className={`browse-dropdown-trigger ${catalogGroups.length ? "active" : ""}`}
                aria-haspopup="dialog"
                onClick={() => setOpenPanel("filter")}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                  <path d="M4 7h16M4 17h16M8 4v6m8 4v6" />
                </svg>
                <span>Filter</span>
                {catalogGroups.length ? <span className="browse-filter-count">{catalogGroups.length}</span> : null}
              </button>
              {catalogGroups.length ? (
                <button
                  type="button"
                  data-tv-focusable="true"
                  className="browse-dropdown-trigger browse-clear-filters"
                  onClick={() => {
                    document.querySelector<HTMLElement>('[data-browse-open="filter"]')?.focus({ preventScroll: true });
                    clearFilters();
                  }}
                >
                  <span>Clear filters</span>
                  <span aria-hidden="true">×</span>
                </button>
              ) : null}
              {shuffleSupported && shuffleTarget && visibleItems.length ? (
                <button
                  type="button"
                  data-tv-focusable="true"
                  className="browse-shuffle"
                  onClick={() => void shuffle()}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                  </svg>
                  <span>Shuffle</span>
                </button>
              ) : null}
              {collection && !hasMoreBrowseItems && !loading && visibleItems.length ? (
                <span className="browse-item-count">{visibleItems.length === 1 ? "1 item" : `${visibleItems.length} items`}</span>
              ) : null}
            </div>}
            {filterOptionsError ? <div className="error">{filterOptionsError}</div> : null}
            {shuffleError ? <div className="error">{shuffleError}</div> : null}
            {selectableLibraries ? (
              <div className="library-filter-row">
                <button
                  data-tv-focusable="true"
                  className={`library-view-tab ${selectedLibraryIds.length === libraries.length ? "active" : ""}`}
                  onClick={() => setSelectedLibraryIds(libraries.map(library => library.id))}
                >
                  All Libraries
                </button>
                {libraries.map(library => (
                  <button
                    key={library.id}
                    data-tv-focusable="true"
                    className={`library-view-tab ${selectedLibraryIds.length === 1 && selectedLibraryIds[0] === library.id ? "active" : ""}`}
                    onClick={() => setSelectedLibraryIds([library.id])}
                  >
                    {library.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {error && browseItems.length ? <div className="error">{error}</div> : null}
          {loading ? <LoadingState label="Loading" /> : !browseItems.length && error ? (
            <div className="screen-state browse-error-state">
              <div>{error}</div>
              <div className="browse-error-actions">
                <button ref={retryRef} type="button" data-tv-focusable="true" className="browse-dropdown-trigger" onClick={() => setReloadNonce(nonce => nonce + 1)}>
                  <span>Retry</span>
                </button>
                {catalogGroups.length || !matchAll || namePrefix ? (
                  <button type="button" data-tv-focusable="true" className="browse-dropdown-trigger" onClick={clearFilters}>
                    <span>Clear filters</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {visibleItems.length ? (
                <div className="library-grid">
                  {visibleItems.map((item) => (
                    <MediaCard key={item.Id} session={session} item={item} image={imageUrl(session, item)} onOpen={() => { browseReturnTargets.set(surfaceKey, item.Id); onOpen(item); }} variant="browse" />
                  ))}
                </div>
              ) : <div className="screen-state">{hasMoreBrowseItems ? "Loading library items…" : libraryEmpty === false || (libraryEmpty === null && (catalogGroups.length || namePrefix)) ? "No titles match the current filters." : "This library is empty."}</div>}
              {hasMoreBrowseItems ? (
                <div ref={browseSentinel} className="browse-load-more" aria-hidden="true" />
              ) : null}
            </>
          )}
        </div>
      </div>
      {showAlphaRail ? (
        <aside className="library-alpha-nav" aria-label="Jump to title">
          {["", "#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((prefix, index) => {
            const selected = (namePrefix ?? "") === prefix;
            return (
              <button
                key={prefix || "all"}
                type="button"
                data-tv-focusable="true"
                data-rail-dot={index % 2 === 0 || selected ? "true" : undefined}
                aria-pressed={selected}
                className={`library-alpha-button ${selected ? "selected" : ""}`}
                aria-label={prefix === "" ? "All titles" : prefix === "#" ? "Numbers" : `Titles beginning with ${prefix}`}
                onClick={() => {
                  if ((namePrefix ?? "") === prefix) return;
                  pendingLetterFocusRef.current = true;
                  setNamePrefix(prefix || null);
                }}
              >
                {prefix || "All"}
              </button>
            );
          })}
        </aside>
      ) : null}
      {openPanel ? (
        <LibraryBrowsePanels
          initialPanel={openPanel}
          sortOptions={availableSortOptions}
          sort={sort}
          order={order}
          onSort={(nextSort, nextOrder) => {
            setSort(nextSort);
            setOrder(nextOrder);
          }}
          onClose={closeBrowsePanel}
          options={filterOptions}
          selection={filters}
          matchAll={matchAll}
          onApplyFilters={(nextFilters, nextMatchAll) => {
            setFilters(nextFilters);
            setMatchAll(nextMatchAll);
            setNamePrefix(null);
          }}
          preserve={preserve}
          onPreserveChange={persistsPrefs ? next => {
            setPreserve(next);
            writePreserve(prefsKey, next);
            if (next) writeBrowsePrefs(prefsKey, { sort, order, filters, matchAll });
          } : undefined}
          scope={catalogScope}
          audiobookLibrary={activeLibraries.length > 0 && activeLibraries.every(isAudiobookLibrary)}
          session={session}
          libraryIds={browseLibraryKey ? browseLibraryKey.split(",") : []}
        />
      ) : null}
    </main>
  );
}
