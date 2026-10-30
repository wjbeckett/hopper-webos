import { useEffect, useMemo, useState } from "react";
import { getFavorites, getWatchlist, imageUrl } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { SortDropdown } from "../components/SortDropdown";
import { focusFirstContentCard } from "../navigation/spatial";
import type { Session, SiloItem } from "../types";
import { LoadingState } from "../components/LoadingState";

type PersonalFilter = "all" | "movies" | "series" | "episodes" | "unwatched" | "in-progress" | "watched";

function matchesFilter(item: SiloItem, filter: PersonalFilter) {
  const progress = item.UserData?.PlayedPercentage ?? 0;
  const inProgress = progress > 0 && progress < 100;
  if (filter === "movies") return item.Type === "Movie";
  if (filter === "series") return item.Type === "Series";
  if (filter === "episodes") return item.Type === "Episode";
  if (filter === "unwatched") return item.UserData?.Played !== true && !inProgress;
  if (filter === "in-progress") return inProgress;
  if (filter === "watched") return item.UserData?.Played === true || progress >= 100;
  return true;
}

export function PersonalScreen({
  session,
  kind,
  onOpen
}: {
  session: Session;
  kind: "favorites" | "watchlist";
  onOpen: (item: SiloItem) => void;
}) {
  const [items, setItems] = useState<SiloItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<"added" | "title" | "movies" | "series">("added");
  const [filter, setFilter] = useState<PersonalFilter>("all");
  const [openDropdown, setOpenDropdown] = useState<"sort" | "filter" | null>(null);
  const title = kind === "favorites" ? "Favorites" : "Watchlist";
  const sortedItems = useMemo(() => {
    if (sort === "added") return items;
    return [...items].sort((left, right) => {
      if (sort === "title") return left.Name.localeCompare(right.Name);
      const preferred = sort === "movies" ? "Movie" : "Series";
      const leftRank = left.Type === preferred ? 0 : 1;
      const rightRank = right.Type === preferred ? 0 : 1;
      return leftRank - rightRank || left.Name.localeCompare(right.Name);
    });
  }, [items, sort]);
  const filteredItems = useMemo(
    () => sortedItems.filter(item => matchesFilter(item, filter)),
    [sortedItems, filter]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    (kind === "favorites" ? getFavorites(session) : getWatchlist(session))
      .then((next) => { if (alive) setItems(next); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : `Could not load ${title}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, kind]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, filteredItems]);

  return (
    <main className="content-screen personal-screen">
      <div className="screen-title">
        <div className="eyebrow">Your Silo</div>
        <h1>{title}</h1>
      </div>
      <div className="browse-toolbar personal-toolbar" aria-label={`${title} controls`}>
        <SortDropdown
          id="personal-sort"
          label="Sort"
          value={sort}
          options={[
            { value: "added", label: "Date Added" },
            { value: "title", label: "Title A–Z" },
            { value: "movies", label: "Movies First" },
            { value: "series", label: "Series First" }
          ]}
          open={openDropdown === "sort"}
          onToggle={() => setOpenDropdown(current => current === "sort" ? null : "sort")}
          onSelect={value => { setSort(value); setOpenDropdown(null); }}
        />
        <SortDropdown
          id="personal-filter"
          label="Filter"
          value={filter}
          options={[
            { value: "all", label: "All items" },
            { value: "movies", label: "Movies" },
            { value: "series", label: "Series" },
            { value: "episodes", label: "Episodes" },
            { value: "unwatched", label: "Unwatched" },
            { value: "in-progress", label: "In progress" },
            { value: "watched", label: "Watched" }
          ]}
          open={openDropdown === "filter"}
          onToggle={() => setOpenDropdown(current => current === "filter" ? null : "filter")}
          onSelect={value => { setFilter(value); setOpenDropdown(null); }}
        />
      </div>
      {error ? <div className="error">{error}</div> : null}
      {loading ? <LoadingState label="Loading" /> : items.length ? (
        <div className="library-grid">
          {filteredItems.map((item) => (
            <MediaCard key={item.Id} session={session} item={item} image={imageUrl(session, item)} onOpen={() => onOpen(item)} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-state-mark" aria-hidden="true">{kind === "favorites" ? "♡" : "▢"}</span>
          <h2>No {title.toLowerCase()} yet</h2>
          <p>Save titles from their details page and they’ll be ready for you here.</p>
        </div>
      )}
      {!loading && !error && items.length > 0 && !filteredItems.length ? (
        <div className="empty-state compact-empty-state">
          <h2>No matching titles</h2>
          <p>Try a different filter to see more of your {title.toLowerCase()}.</p>
        </div>
      ) : null}
    </main>
  );
}
