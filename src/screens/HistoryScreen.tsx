import { useCallback, useEffect, useRef, useState } from "react";
import { getHistoryPage, imageUrl } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { focusFirstContentCard } from "../navigation/spatial";
import type { Session, SiloItem } from "../types";

export function HistoryScreen({ session, onOpen }: {
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const [items, setItems] = useState<SiloItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const seenCursors = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    getHistoryPage(session)
      .then(page => {
        if (!alive) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load watch history."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      if (seenCursors.current.has(cursor)) {
        setCursor(undefined);
        throw new Error("Silo repeated a watch history cursor.");
      }
      seenCursors.current.add(cursor);
      const page = await getHistoryPage(session, cursor);
      if (page.nextCursor && seenCursors.current.has(page.nextCursor)) {
        setCursor(undefined);
        throw new Error("Silo returned an invalid watch history continuation.");
      }
      setItems(current => {
        const ids = new Set(current.map(item => item.Id));
        return [...current, ...page.items.filter(item => {
          if (ids.has(item.Id)) return false;
          ids.add(item.Id);
          return true;
        })];
      });
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more watch history.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, session]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, items]);

  useEffect(() => {
    if (!cursor || loading || error) return;
    const target = sentinel.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "1000px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, loading, error, loadMore]);

  return (
    <main className="content-screen history-screen">
      {error ? <div className="error">{error}</div> : null}
      {loading ? <div className="screen-state">Loading watch history…</div> : items.length ? (
        <div className="library-grid">
          {items.map(item => <MediaCard key={item.Id} item={item} image={imageUrl(session, item)} onOpen={() => onOpen(item)} />)}
        </div>
      ) : !error ? <div className="empty-state"><h2>No watch history yet</h2><p>Titles you watch will appear here.</p></div> : null}
      {cursor ? <div className="history-load-more" ref={sentinel} aria-live="polite">
        {loadingMore ? <span>Loading more history…</span> : <button data-tv-focusable="true" className="tv-button secondary" onClick={() => void loadMore()}>Load more</button>}
      </div> : null}
    </main>
  );
}
