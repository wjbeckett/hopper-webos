import { useEffect, useMemo, useState } from "react";
import { getFavorites, getWatchlist, imageUrl } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import type { Session, SiloItem } from "../types";

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

  return (
    <main className="content-screen personal-screen">
      <div className="screen-title">
        <div className="eyebrow">Your Silo</div>
        <h1>{title}</h1>
      </div>
      <div className="personal-sort" aria-label={`${title} sorting`}>
        <span>Sort</span>
        {([
          ["added", "Date Added"],
          ["title", "Title"],
          ["movies", "Movies First"],
          ["series", "Series First"]
        ] as const).map(([id, label]) => (
          <button
            key={id}
            data-tv-focusable="true"
            className={`library-view-tab ${sort === id ? "active" : ""}`}
            onClick={() => setSort(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <div className="error">{error}</div> : null}
      {loading ? <div className="screen-state">Loading…</div> : items.length ? (
        <div className="library-grid">
          {sortedItems.map((item) => (
            <MediaCard key={item.Id} item={item} image={imageUrl(session, item)} onOpen={() => onOpen(item)} />
          ))}
        </div>
      ) : <div className="screen-state">No {title.toLowerCase()} yet.</div>}
    </main>
  );
}
