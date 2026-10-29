import { useEffect, useRef, useState } from "react";
import { getCollectionItemsPage, getCollections, imageUrl } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { focusFirstContentCard } from "../navigation/spatial";
import type { Session, SiloCollection, SiloItem } from "../types";

export function CollectionsScreen({ session, onOpen }: {
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const [collections, setCollections] = useState<SiloCollection[]>([]);
  const [selected, setSelected] = useState<SiloCollection | null>(null);
  const [items, setItems] = useState<SiloItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const seenCursors = useRef(new Set<string>());
  const loadSentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getCollections(session)
      .then(result => { if (alive) setCollections(result); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load collections."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, selected, items]);

  useEffect(() => {
    if (!selected || !cursor || loading || loadingMore || error) return;
    const target = loadSentinel.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "1000px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [selected, cursor, loading, loadingMore, error, items]);

  async function openCollection(collection: SiloCollection) {
    setSelected(collection);
    setLoading(true);
    setError("");
    setItems([]);
    setCursor(undefined);
    seenCursors.current.clear();
    try {
      const page = await getCollectionItemsPage(session, collection);
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this collection.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!selected || !cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      if (seenCursors.current.has(cursor)) {
        setCursor(undefined);
        throw new Error("Silo repeated a collection cursor.");
      }
      seenCursors.current.add(cursor);
      const page = await getCollectionItemsPage(session, selected, cursor);
      if (page.nextCursor && seenCursors.current.has(page.nextCursor)) {
        setCursor(undefined);
        throw new Error("Silo returned an invalid collection continuation.");
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
      setError(cause instanceof Error ? cause.message : "Could not load more titles.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (selected) {
    return (
      <main className="content-screen collection-screen" onKeyDownCapture={event => {
        if (["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461) {
          setSelected(null);
          event.preventDefault();
          event.stopPropagation();
        }
      }}>
        <button type="button" className="tv-button secondary" data-tv-focusable="true" onClick={() => setSelected(null)}>‹ Collections</button>
        <h1 className="collection-title">{selected.name}</h1>
        {error ? <div className="error">{error}</div> : null}
        {loading ? <div className="screen-state">Loading collection…</div> : items.length ? (
          <div className="library-grid">
            {items.map(item => <MediaCard key={item.Id} item={item} image={imageUrl(session, item)} onOpen={() => onOpen(item)} />)}
          </div>
        ) : !error ? <div className="empty-state compact-empty-state"><h2>This collection is empty</h2></div> : null}
        {cursor ? (
          <div className="collection-load-more" ref={loadSentinel} aria-live="polite">
            {loadingMore ? <span>Loading more titles…</span> : <button className="tv-button secondary" data-tv-focusable="true" onClick={() => void loadMore()}>Load more</button>}
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="content-screen collection-screen">
      {error ? <div className="error">{error}</div> : null}
      {loading ? <div className="screen-state">Loading collections…</div> : collections.length ? (
        <div className="collection-grid">
          {collections.map(collection => {
            const poster: SiloItem = { Id: collection.id, Name: collection.name, PosterUrl: collection.posterUrl };
            const posterImage = imageUrl(session, poster);
            return (
              <button key={collection.id} type="button" data-tv-focusable="true" className="collection-card" onClick={() => void openCollection(collection)}>
                <div className="collection-card-art">
                  {posterImage ? <img src={posterImage} alt="" loading="lazy" /> : <span aria-hidden="true">▦</span>}
                </div>
                <strong>{collection.name}</strong>
                <small>{collection.itemCount ?? 0} titles{collection.groupName ? ` · ${collection.groupName}` : ""}</small>
              </button>
            );
          })}
        </div>
      ) : !error ? <div className="empty-state"><h2>No collections yet</h2><p>Collections created in Silo will appear here.</p></div> : null}
    </main>
  );
}
