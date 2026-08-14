import { useEffect, useState } from "react";
import { imageUrl, searchItems } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import type { Session, SiloItem } from "../types";

export function SearchScreen({
  session,
  onOpen
}: {
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SiloItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        setItems(await searchItems(session, trimmed));
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [query, session]);

  return (
    <main className="content-screen search-screen">
      <div className="screen-title">
        <div className="eyebrow">Find anything</div>
        <h1>Search</h1>
      </div>
      <input
        className="search-input"
        data-tv-focusable="true"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Movies, shows, episodes, music…"
      />
      {loading ? <div className="screen-state compact-state">Searching…</div> : null}
      <div className="library-grid">
        {items.map((item) => (
          <MediaCard
            key={item.Id}
            item={item}
            image={imageUrl(session, item)}
            onOpen={() => onOpen(item)}
          />
        ))}
      </div>
    </main>
  );
}
