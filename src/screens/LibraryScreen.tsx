import { useEffect, useState } from "react";
import { getCollectionItems, getLibrariesRails, getLibraryCollections, imageUrl } from "../api/silo";
import { MediaRail } from "../components/MediaRail";
import { MediaCard } from "../components/MediaCard";
import type { HomeRail, Session, SiloCollection, SiloItem, SiloLibrary } from "../types";

export function LibraryScreen({
  session,
  title,
  libraries,
  selectableLibraries = false,
  itemTypes,
  onOpen
}: {
  session: Session;
  title: string;
  libraries: SiloLibrary[];
  selectableLibraries?: boolean;
  itemTypes?: string[];
  onOpen: (item: SiloItem) => void;
}) {
  const [rails, setRails] = useState<HomeRail[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"browse" | "collections">("browse");
  const [collections, setCollections] = useState<SiloCollection[]>([]);
  const [activeCollection, setActiveCollection] = useState<SiloCollection | null>(null);
  const [collectionItems, setCollectionItems] = useState<SiloItem[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<number[]>(libraries.map(library => library.id));
  const activeLibraries = selectableLibraries ? libraries.filter(library => selectedLibraryIds.includes(library.id)) : libraries;
  const accepts = (item: SiloItem) => !itemTypes?.length || itemTypes.includes(item.Type ?? "");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    getLibrariesRails(session, activeLibraries)
      .then((data) => alive && setRails(data.map(rail => ({ ...rail, items: rail.items.filter(accepts) })).filter(rail => rail.items.length)))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Library failed"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [session, libraries, selectedLibraryIds.join(","), itemTypes?.join(",")]);

  useEffect(() => {
    if (view !== "collections") return;
    let alive = true;
    setLoading(true);
    Promise.all(activeLibraries.map((library) => getLibraryCollections(session, library.id)))
      .then((groups) => { if (alive) setCollections(groups.flat()); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Collections failed"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, libraries, selectedLibraryIds.join(","), view]);

  function openCollection(collection: SiloCollection) {
    setActiveCollection(collection);
    setLoading(true);
    setError("");
    getCollectionItems(session, collection)
      .then(setCollectionItems)
      .catch((err) => setError(err instanceof Error ? err.message : "Collection failed"))
      .finally(() => setLoading(false));
  }

  return (
    <main className="content-screen">
      <div className="screen-title">
        <div className="eyebrow">Library</div>
        <h1>{activeCollection?.name ?? title}</h1>
      </div>
      <div className="library-view-tabs">
        {activeCollection ? (
          <button data-tv-focusable="true" className="library-view-tab active" onClick={() => setActiveCollection(null)}>
            ← Collections
          </button>
        ) : (
          <>
            <button data-tv-focusable="true" className={`library-view-tab ${view === "browse" ? "active" : ""}`} onClick={() => setView("browse")}>Browse</button>
            <button data-tv-focusable="true" className={`library-view-tab ${view === "collections" ? "active" : ""}`} onClick={() => setView("collections")}>Collections</button>
          </>
        )}
      </div>
      {selectableLibraries && !activeCollection ? <div className="library-filter-row">
        <button data-tv-focusable="true" className={`library-view-tab ${selectedLibraryIds.length === libraries.length ? "active" : ""}`} onClick={() => setSelectedLibraryIds(libraries.map(library => library.id))}>All Libraries</button>
        {libraries.map(library => <button key={library.id} data-tv-focusable="true" className={`library-view-tab ${selectedLibraryIds.length === 1 && selectedLibraryIds[0] === library.id ? "active" : ""}`} onClick={() => setSelectedLibraryIds([library.id])}>{library.name}</button>)}
      </div> : null}
      {error ? <div className="error">{error}</div> : null}
      {loading ? <div className="screen-state">Loading…</div> : activeCollection ? (
        <div className="library-grid">
          {collectionItems.map((item) => <MediaCard key={item.Id} item={item} image={imageUrl(session, item)} onOpen={() => onOpen(item)} />)}
        </div>
      ) : view === "collections" ? (
        collections.length ? <div className="collection-grid">
          {collections.map((collection) => {
            const item: SiloItem = { Id: collection.id, Name: collection.name, Type: collection.itemCount == null ? "Collection" : `${collection.itemCount} items`, PosterUrl: collection.posterUrl };
            return <MediaCard key={`${collection.kind}-${collection.id}`} item={item} image={imageUrl(session, item)} onOpen={() => openCollection(collection)} />;
          })}
        </div> : <div className="screen-state">No collections yet.</div>
      ) : (
        rails.map((rail) => (
          <MediaRail key={rail.id} rail={rail} session={session} onOpen={onOpen} />
        ))
      )}
    </main>
  );
}
