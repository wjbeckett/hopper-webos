import { useEffect, useMemo, useState } from "react";
import { searchCatalogFacet } from "../api/silo";
import type { CatalogFilterOptions, CatalogScope } from "../api/silo";
import type { Session } from "../types";

export type BrowseSortKey = "title" | "added_at" | "release_date" | "year" | "rating_imdb" | "runtime" | "resolution" | "author" | "narrator" | "series" | "collection";
export type BrowseSortOption = {
  id: BrowseSortKey;
  label: string;
  order: "asc" | "desc";
};

type BrowsePanelProps = {
  sortOptions: BrowseSortOption[];
  sort: BrowseSortKey;
  order: "asc" | "desc";
  onSort: (sort: BrowseSortKey, order: "asc" | "desc") => void;
  onClose: () => void;
  options: CatalogFilterOptions;
  selection: Record<string, string[]>;
  matchAll: boolean;
  onApplyFilters: (selection: Record<string, string[]>, matchAll: boolean) => void;
  audiobookLibrary: boolean;
  initialPanel: "sort" | "filter";
  session: Session;
  libraryIds: string[];
  preserve: boolean;
  onPreserveChange?: (preserve: boolean) => void;
  scope?: CatalogScope;
};

type Facet = { id: string; label: string; options: { value: string; label: string }[]; mode?: "single" };

const watchStatuses = [
  { value: "unwatched", label: "Unwatched" },
  { value: "in_progress", label: "In Progress" },
  { value: "watched", label: "Watched" },
  { value: "favorited", label: "Favorited" },
  { value: "watchlist", label: "Watchlist" }
];

const decades = [2020, 2010, 2000, 1990, 1980, 1970, 1960]
  .map(year => ({ value: String(year), label: `${year}s` }));

function sortedOptions(values: string[] | undefined) {
  return [...new Set(values ?? [])]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(value => ({ value, label: value }));
}

function directionLabel(sort: BrowseSortKey, order: "asc" | "desc") {
  if (sort === "collection") return "Default";
  if (["title", "author", "narrator", "series"].includes(sort)) return order === "asc" ? "A–Z" : "Z–A";
  if (["release_date", "year", "added_at"].includes(sort)) return order === "asc" ? "Oldest" : "Newest";
  if (sort === "runtime") return order === "asc" ? "Shortest" : "Longest";
  return order === "asc" ? "Lowest" : "Highest";
}

export function LibraryBrowsePanels({
  sortOptions,
  sort,
  order,
  onSort,
  onClose,
  options: filterOptions,
  selection,
  matchAll,
  onApplyFilters,
  audiobookLibrary,
  initialPanel,
  session,
  libraryIds,
  preserve,
  onPreserveChange,
  scope
}: BrowsePanelProps) {
  const [activePanel] = useState(initialPanel);
  const [draft, setDraft] = useState(selection);
  const [draftMatchAll, setDraftMatchAll] = useState(matchAll);
  const [activeFacet, setActiveFacet] = useState<string | null>(null);
  const [facetQuery, setFacetQuery] = useState("");
  const [facetMatches, setFacetMatches] = useState<string[]>([]);
  const [facetHasMore, setFacetHasMore] = useState(false);
  const [facetSearching, setFacetSearching] = useState(false);
  const [facetSearchError, setFacetSearchError] = useState("");
  const libraryIdsKey = libraryIds.join(",");

  const facets = useMemo<Facet[]>(() => {
    const videoFacets: Facet[] = [
      { id: "genre", label: "Genre", options: sortedOptions(filterOptions.genres) },
      { id: "decade", label: "Decade", options: decades },
      { id: "watch_status", label: "Watch Status", options: watchStatuses, mode: "single" },
      { id: "content_rating", label: "Content Rating", options: sortedOptions(filterOptions.contentRatings) },
      { id: "resolution", label: "Resolution", options: sortedOptions(filterOptions.resolutions) },
      { id: "dynamic_range", label: "Dynamic Range", options: [{ value: "hdr", label: "HDR" }, { value: "dolby_vision", label: "Dolby Vision" }] },
      { id: "studio", label: "Studio", options: sortedOptions(filterOptions.studios) },
      { id: "network", label: "Network", options: sortedOptions(filterOptions.networks) },
      { id: "country", label: "Country", options: sortedOptions(filterOptions.countries) },
      { id: "audio_language", label: "Audio Language", options: sortedOptions(filterOptions.audioLanguages) },
      { id: "subtitle_language", label: "Subtitle Language", options: sortedOptions(filterOptions.subtitleLanguages) },
      { id: "original_language", label: "Original Language", options: sortedOptions(filterOptions.originalLanguages) }
    ];
    const audiobookFacets: Facet[] = [
      { id: "genre", label: "Genre", options: sortedOptions(filterOptions.genres) },
      { id: "author", label: "Author", options: sortedOptions(filterOptions.authors) },
      { id: "narrator", label: "Narrator", options: sortedOptions(filterOptions.narrators) },
      { id: "series", label: "Series", options: sortedOptions(filterOptions.series) },
      { id: "decade", label: "Decade", options: decades },
      { id: "watch_status", label: "Watch Status", options: watchStatuses, mode: "single" }
    ];
    return (audiobookLibrary ? audiobookFacets : videoFacets).filter(facet => facet.options.length > 0);
  }, [audiobookLibrary, filterOptions]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".browse-panel [data-browse-panel-initial-focus]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeFacet]);

  useEffect(() => {
    setFacetQuery("");
    setFacetMatches([]);
    setFacetHasMore(false);
    setFacetSearchError("");
  }, [activeFacet]);

  useEffect(() => {
    const facet = activeFacet;
    const query = facetQuery.trim();
    if ((facet !== "author" && facet !== "narrator" && facet !== "series") || !libraryIdsKey) {
      setFacetSearching(false);
      setFacetMatches([]);
      setFacetHasMore(false);
      setFacetSearchError("");
      return;
    }

    let alive = true;
    setFacetSearching(true);
    setFacetSearchError("");
    setFacetMatches([]);
    setFacetHasMore(false);
    const timer = window.setTimeout(() => {
      void searchCatalogFacet(
        session,
        libraryIdsKey.split(","),
        facet,
        query,
        undefined,
        scope
      ).then(result => {
        if (!alive) return;
        setFacetMatches(result.matches);
        setFacetHasMore(result.hasMore);
      }).catch(cause => {
        if (alive) setFacetSearchError(cause instanceof Error ? cause.message : "Could not search filter values.");
      }).finally(() => {
        if (alive) setFacetSearching(false);
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [activeFacet, facetQuery, libraryIdsKey, session, scope]);

  const selectedFacet = facets.find(facet => facet.id === activeFacet) ?? null;
  const activeFacetCount = Object.values(draft).filter(values => values.length > 0).length;

  function closeAndApply() {
    if (activePanel === "filter") onApplyFilters(draft, draftMatchAll);
    onClose();
  }

  function handleBack() {
    if (activePanel === "filter" && activeFacet) {
      setActiveFacet(null);
      return;
    }
    closeAndApply();
  }

  useEffect(() => {
    window.addEventListener("silo:browse-panel-back", handleBack);
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowLeft"
        && activeFacet
        && !(document.activeElement instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        event.stopPropagation();
        setActiveFacet(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("silo:browse-panel-back", handleBack);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [activePanel, activeFacet, draft, draftMatchAll, onApplyFilters, onClose]);

  function toggleValue(facet: Facet, value: string) {
    setDraft(current => {
      const selected = current[facet.id] ?? [];
      const next = selected.includes(value)
        ? selected.filter(item => item !== value)
        : facet.mode === "single" ? [value] : [...selected, value];
      return { ...current, [facet.id]: next };
    });
  }

  function clearFacet(facet: Facet) {
    setDraft(current => ({ ...current, [facet.id]: [] }));
    // The Clear row goes away with the selection; put focus on the row above it.
    document.querySelector<HTMLElement>(".browse-panel [data-browse-panel-initial-focus]")?.focus({ preventScroll: true });
  }

  function facetSummary(facet: Facet) {
    const values = draft[facet.id] ?? [];
    if (!values.length) return "Any";
    if (values.length > 1) return `${values.length} selected`;
    return facet.options.find(option => option.value === values[0])?.label ?? values[0];
  }

  const remoteFacet = selectedFacet && ["author", "narrator", "series"].includes(selectedFacet.id);
  const visibleFacetOptions = remoteFacet
    ? facetMatches.map(value => ({ value, label: value }))
    : selectedFacet?.options ?? [];

  return (
    <div className="browse-panel-scrim" onClick={event => {
      if (event.target === event.currentTarget) handleBack();
    }}>
      <section
        className={`browse-panel browse-panel-${activePanel}`}
        role="dialog"
        aria-modal="true"
        aria-label={activePanel === "sort" ? "Sort library" : "Filter library"}
      >
        <div className="browse-panel-eyebrow">
          {activePanel === "sort" ? "SORT BY" : selectedFacet ? "FILTER" : "FILTER BY"}
        </div>
        <h2 className="browse-panel-title">
          {activePanel === "sort" ? "Sort" : selectedFacet?.label ?? "Filters"}
        </h2>
        <div className="browse-panel-divider" />

        {activePanel === "sort" ? (
          <div className="browse-panel-list" role="list">
            {sortOptions.map(option => {
              const selected = sort === option.id;
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  data-tv-focusable="true"
                  data-browse-panel-initial-focus={selected || undefined}
                  className={`browse-panel-row ${selected ? "selected" : ""}`}
                  key={option.id}
                  onClick={() => {
                    if (selected && option.id !== "collection") onSort(option.id, order === "asc" ? "desc" : "asc");
                    else if (selected) onSort(option.id, option.order);
                    else onSort(option.id, option.order);
                    onClose();
                  }}
                >
                  <span className="browse-panel-check">{selected ? "✓" : ""}</span>
                  <span>{option.label}</span>
                  {selected && option.id === "collection" ? (
                    <span className="browse-panel-direction">Default</span>
                  ) : selected ? (
                    <>
                      <span className="browse-panel-direction">{directionLabel(sort, order)}</span>
                      <span className="browse-panel-arrow">{order === "asc" ? "↑" : "↓"}</span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : selectedFacet ? (
          <div className="browse-panel-content">
            <div className="browse-panel-list">
              <button
                type="button"
                data-tv-focusable="true"
                data-browse-panel-initial-focus="true"
                className="browse-panel-row"
                onClick={() => setActiveFacet(null)}
              >
                <span className="browse-panel-back">‹</span>
                <span>All filters</span>
              </button>
              {(draft[selectedFacet.id]?.length ?? 0) > 0 ? (
                <button
                  type="button"
                  data-tv-focusable="true"
                  className="browse-panel-row"
                  onClick={() => clearFacet(selectedFacet)}
                >
                  <span className="browse-panel-check">×</span>
                  <span>Clear {selectedFacet.label}</span>
                </button>
              ) : null}
              {remoteFacet ? (
                <>
                  <input
                    type="search"
                    className="browse-panel-search"
                    data-tv-focusable="true"
                    aria-label={`Search ${selectedFacet.label}`}
                    placeholder={`Search ${selectedFacet.label}`}
                    value={facetQuery}
                    onChange={event => setFacetQuery(event.currentTarget.value)}
                  />
                  {facetSearching ? <div className="browse-panel-note">Searching…</div> : null}
                  {facetSearchError ? <div className="browse-panel-search-error">{facetSearchError}</div> : null}
                  {facetHasMore && !facetSearching ? <div className="browse-panel-note">More matches are available. Refine your search.</div> : null}
                  {!facetSearching && !facetSearchError && !facetHasMore
                    ? <div className="browse-panel-note">{visibleFacetOptions.length === 0 && facetQuery.trim() ? "No matches found." : "Search by the beginning of a name."}</div>
                    : null}
                </>
              ) : null}
              {visibleFacetOptions.map(option => {
                const checked = draft[selectedFacet.id]?.includes(option.value) ?? false;
                return (
                  <button
                    type="button"
                    role={selectedFacet.mode === "single" ? "radio" : "checkbox"}
                    aria-checked={checked}
                    data-tv-focusable="true"
                    className={`browse-panel-row ${checked ? "selected" : ""}`}
                    key={option.value}
                    onClick={() => toggleValue(selectedFacet, option.value)}
                  >
                    <span className={`browse-panel-check ${selectedFacet.mode === "single" ? "round" : ""}`}>{checked ? "✓" : ""}</span>
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="browse-panel-content">
            <div className="browse-panel-list">
              {facets.length === 0 ? <div className="browse-panel-note">No filters available</div> : null}
              {facets.map((facet, index) => (
                <button
                  type="button"
                  data-tv-focusable="true"
                  data-browse-panel-initial-focus={index === 0 || undefined}
                  className="browse-panel-row"
                  key={facet.id}
                  onClick={() => setActiveFacet(facet.id)}
                >
                  <span>{facet.label}</span>
                  <span className="browse-panel-summary">{facetSummary(facet)}</span>
                  <span className="browse-panel-chevron">›</span>
                </button>
              ))}
              <div className="browse-panel-section-heading">MATCH</div>
              <button
                type="button"
                role="radio"
                aria-checked={draftMatchAll}
                data-tv-focusable="true"
                className={`browse-panel-row ${draftMatchAll ? "selected" : ""}`}
                onClick={() => setDraftMatchAll(true)}
              >
                <span className="browse-panel-check round">{draftMatchAll ? "✓" : ""}</span>
                <span>All selected filters</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!draftMatchAll}
                data-tv-focusable="true"
                className={`browse-panel-row ${!draftMatchAll ? "selected" : ""}`}
                onClick={() => setDraftMatchAll(false)}
              >
                <span className="browse-panel-check round">{!draftMatchAll ? "✓" : ""}</span>
                <span>Any selected filter</span>
              </button>
              {onPreserveChange ? (
                <>
                  <div className="browse-panel-section-heading">OPTIONS</div>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={preserve}
                    data-tv-focusable="true"
                    className={`browse-panel-row ${preserve ? "selected" : ""}`}
                    onClick={() => onPreserveChange(!preserve)}
                  >
                    <span className="browse-panel-check">{preserve ? "✓" : ""}</span>
                    <span>Preserve sort &amp; filters</span>
                  </button>
                </>
              ) : null}
              <button
                type="button"
                data-tv-focusable="true"
                className="browse-panel-row"
                aria-disabled={!activeFacetCount && draftMatchAll}
                onClick={() => {
                  setDraft({});
                  setDraftMatchAll(true);
                }}
              >
                <span className="browse-panel-check">↻</span>
                <span>Reset filters</span>
              </button>
              <button
                type="button"
                data-tv-focusable="true"
                className="browse-panel-row"
                onClick={closeAndApply}
              >
                <span className="browse-panel-check">✓</span>
                <span>Done</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
