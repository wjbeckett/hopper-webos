import { useCallback, useEffect, useState } from "react";
import { getLibraryCollectionSections, imageUrl } from "../api/silo";
import type { CollectionSection } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { focusFirstContentCard, focusNavigationTarget } from "../navigation/spatial";
import type { Session, SiloCollection, SiloLibrary } from "../types";
import { LoadingState } from "../components/LoadingState";

type LibrarySection = CollectionSection & { library: SiloLibrary };

export type OpenedCollection = { library: SiloLibrary; collection: SiloCollection };

const lastFocused = new Map<string, string>();

export function LibraryCollectionsScreen({ session, libraries, scopeKey, onOpen }: {
  session: Session;
  libraries: SiloLibrary[];
  scopeKey: string;
  onOpen: (opened: OpenedCollection) => void;
}) {
  const [sections, setSections] = useState<LibrarySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const librariesKey = libraries.map(library => library.id).join(",");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all(libraries.map(library =>
      getLibraryCollectionSections(session, library.id).then(result => result.map(section => ({ ...section, library })))
    ))
      .then(results => { if (alive) setSections(results.flat()); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load collections."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, librariesKey, nonce]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(() => {
      const remembered = lastFocused.get(scopeKey);
      const target = remembered ? document.querySelector<HTMLElement>(`[data-collection-key="${CSS.escape(remembered)}"] button`) : null;
      if (target) {
        target.scrollIntoView({ block: "center" });
        focusNavigationTarget(target);
      } else {
        focusFirstContentCard();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, scopeKey]);

  const open = useCallback((library: SiloLibrary, collection: SiloCollection) => {
    lastFocused.set(scopeKey, `${library.id}:${collection.kind}:${collection.id}`);
    onOpen({ library, collection });
  }, [scopeKey, onOpen]);

  const multiple = libraries.length > 1;

  return (
    <main className="content-screen collection-screen library-collections-screen">
      {loading ? <LoadingState label="Loading" /> : error ? (
        <div className="screen-state browse-error-state">
          <div>{error}</div>
          <div className="browse-error-actions">
            <button type="button" data-tv-focusable="true" className="browse-dropdown-trigger" onClick={() => setNonce(value => value + 1)}>
              <span>Retry</span>
            </button>
          </div>
        </div>
      ) : !sections.length ? <div className="screen-state">No collections in this library.</div> : (
        <div className="collection-grid library-collection-grid">
          {sections.map((section, index) => {
            const heading = section.name || (multiple ? section.library.name : "");
            return (
              <div className="collection-section" key={`${section.library.id}-${index}`}>
                {heading ? <h2 className="collection-section-title">{heading}</h2> : null}
                <div className="collection-section-grid">
                  {section.collections.map(collection => {
                    const key = `${section.library.id}:${collection.kind}:${collection.id}`;
                    return (
                      <div key={key} className="collection-cell" data-collection-key={key}>
                        <MediaCard
                          session={session}
                          item={{ Id: collection.id, Name: collection.name, PosterUrl: collection.posterUrl, Type: "Collection" }}
                          image={imageUrl(session, { Id: collection.id, Name: collection.name, PosterUrl: collection.posterUrl })}
                          caption=""
                          variant="browse"
                          onOpen={() => open(section.library, collection)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
