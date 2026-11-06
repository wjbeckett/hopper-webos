import { useCallback, useEffect, useRef, useState } from "react";
import { getSectionBrowsePage, imageUrl } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { LoadingState } from "../components/LoadingState";
import { focusFirstContentCard } from "../navigation/spatial";
import { filterTvVisibleTypes, matchesLibraryMediaScope } from "../core/tvMediaTypes";
import type { Session, SiloItem } from "../types";

export type SectionBrowseArgs = {
  sectionId: string;
  title: string;
  libraryId: number | string | null;
  mediaScope?: string | null;
};

const sectionReturnTargets = new Map<string, string>();

// A section page can come back empty after filtering (mixed shelf filtered
// to Movies/Series, ebook-like types hidden on TV). Page on until one
// visible card lands or the row ends, since the grid can never load past
// a page that added nothing.
async function loadSectionPage(
  session: Session,
  args: SectionBrowseArgs,
  cursor: string | undefined
): Promise<{ added: SiloItem[]; nextCursor?: string }> {
  if (!args.sectionId) throw new Error("Invalid section.");
  let currentCursor = cursor;
  const added: SiloItem[] = [];
  while (true) {
    const page = await getSectionBrowsePage(
      session,
      { libraryId: args.libraryId, sectionId: args.sectionId },
      currentCursor,
      50
    );
    const visible = filterTvVisibleTypes(page.items).filter((item) =>
      matchesLibraryMediaScope(item.Type, args.mediaScope ?? null)
    );
    const seen = new Set(added.map((item) => item.Id));
    for (const item of visible) {
      if (!seen.has(item.Id)) {
        seen.add(item.Id);
        added.push(item);
      }
    }
    if (!page.nextCursor || added.length > 0) return { added, nextCursor: page.nextCursor };
    currentCursor = page.nextCursor;
  }
}

function isUnavailable(error: unknown) {
  return error instanceof Error && error.message.includes(": 404 ");
}

function sectionBrowseKey(args: SectionBrowseArgs) {
  return `section-${args.libraryId ?? "home"}-${args.sectionId}-${args.mediaScope ?? ""}`;
}

export function SectionBrowseScreen({ session, args, onOpen }: {
  session: Session;
  args: SectionBrowseArgs;
  onOpen: (item: SiloItem) => void;
}) {
  const [items, setItems] = useState<SiloItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const argsKey = sectionBrowseKey(args);

  useEffect(() => {
    let alive = true;
    setItems([]);
    setNextCursor(undefined);
    setLoading(true);
    setError("");
    setLoadMoreError("");
    setUnavailable(false);
    loadSectionPage(session, args, undefined)
      .then(page => {
        if (!alive) return;
        setItems(page.added);
        setNextCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        if (isUnavailable(cause)) setUnavailable(true);
        else setError(cause instanceof Error ? cause.message : "Couldn't load this row.");
        setLoading(false);
      });
    return () => { alive = false; };
  }, [argsKey, session, reloadToken]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const page = await loadSectionPage(session, args, nextCursor);
      setItems(current => {
        const seen = new Set(current.map(item => item.Id));
        return [...current, ...page.added.filter(item => !seen.has(item.Id))];
      });
      setNextCursor(page.nextCursor === nextCursor ? undefined : page.nextCursor);
    } catch (cause: unknown) {
      setLoadMoreError(cause instanceof Error ? cause.message : "Could not load more.");
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [args, nextCursor, session]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !nextCursor || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "1600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, items.length]);

  useEffect(() => {
    if (loading) return;
    const target = sectionReturnTargets.get(argsKey);
    const frame = requestAnimationFrame(() => {
      if (!target) {
        focusFirstContentCard();
        return;
      }
      const card = document.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(target)}"]`);
      if (card) {
        card.scrollIntoView({ block: "center" });
        card.focus({ preventScroll: true });
      } else {
        focusFirstContentCard();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, argsKey]);

  if (unavailable) {
    return (
      <main className="content-screen">
        <div className="screen-title">
          <h1>{args.title}</h1>
        </div>
        <div className="screen-state">This row is no longer available.</div>
      </main>
    );
  }

  if (loading && !items.length) return <LoadingState label="Loading" />;
  if (error && !items.length) {
    return (
      <main className="content-screen">
        <div className="screen-title">
          <h1>{args.title}</h1>
        </div>
        <div className="screen-state browse-error-state">
          <div>{error}</div>
          <div className="browse-error-actions">
            <button type="button" data-tv-focusable="true" className="browse-dropdown-trigger" onClick={() => setReloadToken(value => value + 1)}>
              <span>Retry</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="content-screen">
      <div className="screen-title">
        <h1>{args.title}</h1>
      </div>
      {items.length ? (
        <>
          <div className="library-grid">
            {items.map(item => (
              <MediaCard
                key={item.Id}
                session={session}
                item={item}
                image={imageUrl(session, item)}
                variant="browse"
                onOpen={() => { sectionReturnTargets.set(argsKey, item.Id); onOpen(item); }}
              />
            ))}
          </div>
          <div ref={sentinelRef} className="browse-load-more" aria-hidden="true">
            {loadingMore ? "Loading more…" : loadMoreError ? <button type="button" data-tv-focusable="true" className="browse-dropdown-trigger" onClick={() => void loadMore()}><span>Retry</span></button> : null}
          </div>
        </>
      ) : (
        <div className="screen-state">This row has no titles right now.</div>
      )}
    </main>
  );
}
