import { useEffect, useRef, useState } from "react";
import { imageUrl, searchItems } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { homeRailsKey } from "../core/homeRailsCache";
import type { Session, SiloItem } from "../types";

/**
 * The search a result was opened from. The screen unmounts while the result's page or the
 * player is open; Back shows the same query and results again, with focus on that result.
 * Choosing Search from the top bar starts empty.
 */
let openedFrom: { owner: string; query: string; items: SiloItem[]; index: number } | null = null;

export function SearchScreen({
  session,
  onOpen
}: {
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const [returned] = useState(() => {
    const from = openedFrom?.owner === homeRailsKey(session) ? openedFrom : null;
    openedFrom = null;
    return from;
  });
  const [query, setQuery] = useState(returned?.query ?? "");
  const [items, setItems] = useState<SiloItem[]>(returned?.items ?? []);
  // The results shown on return are the ones already fetched; only a changed query searches again.
  const skipSearch = useRef(returned !== null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!returned) return;
    const frame = requestAnimationFrame(() => {
      const cards = document.querySelectorAll<HTMLElement>(".search-screen .library-grid .media-card");
      const card = cards[returned.index] ?? cards[0];
      if (!card) return;
      card.scrollIntoView({ block: "center" });
      card.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [returned]);

  useEffect(() => {
    if (skipSearch.current) { skipSearch.current = false; return; }
    let alive = true;
    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setLoading(false);
      setError("");
      return () => { alive = false; };
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const results = await searchItems(session, trimmed);
        if (alive) setItems(results);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Search failed.");
      } finally {
        if (alive) setLoading(false);
      }
    }, 350);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, session]);

  return (
    <main className="content-screen search-screen">
      <div className="search-intro">
        <div className="eyebrow">Find anything</div>
        <h1>Search</h1>
        <p>Find a movie, series, episode, or person in your library.</p>
      </div>
      <div className="search-field">
        <span className="search-field-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          className="search-input"
          data-tv-focusable="true"
          autoFocus={!returned}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your Silo library"
          aria-label="Search your Silo library"
        />
        {query ? (
          <button type="button" className="search-clear" data-tv-focusable="true" onClick={() => setQuery("")}>
            Clear
          </button>
        ) : null}
      </div>
      {loading ? <div className="screen-state compact-state">Searching…</div> : null}
      {error ? <div className="error">{error}</div> : null}
      {!query.trim() ? <p className="search-hint">Start typing to see matching titles.</p> : null}
      {query.trim() && !loading && !error ? <h2 className="search-results-heading">Results <span>{items.length}</span></h2> : null}
      {query.trim() && !loading && !error && !items.length ? (
        <div className="empty-state compact-empty-state">
          <h2>No matches</h2>
          <p>Try a different title, series, episode, or person.</p>
        </div>
      ) : null}
      {items.length ? <div className="library-grid">
        {items.map((item, index) => (
          <MediaCard
            key={item.Id}
            session={session}
            item={item}
            image={imageUrl(session, item)}
            onOpen={() => { openedFrom = { owner: homeRailsKey(session), query, items, index }; onOpen(item); }}
          />
        ))}
      </div> : null}
    </main>
  );
}
