import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { cardBackdropUrl, imageUrl } from "../api/silo";
import { isTvDevice, warmArtworkImage } from "../core/artwork";
import type { HomeRail, Session, SiloItem } from "../types";
import { MediaCard } from "./MediaCard";

// Android SECTION_ROW_MAX_ITEMS: a row shows at most 20 cards; the rest live
// on the row's full page behind the trailing "Explore all" card.
const SECTION_ROW_MAX_ITEMS = 20;
/** Continue Watching cards decoded ahead of time on the TV. */
const CW_WARM_COUNT = 10;
/**
 * Cards rendered on each side of the focused one. The focused card sits mid-row, so this
 * covers the visible cards plus a few spare for held keys. Every other position is an empty
 * placeholder of the same width, which keeps the row's scroll width and each card's index.
 */
const WINDOW_POSTER = 8;
const WINDOW_WIDE = 5;

export const MediaRail = memo(function MediaRail({
  rail,
  session,
  onOpen,
  onExplore,
  live = true,
  initialAnchor = 0,
  slide = false
}: {
  rail: HomeRail;
  session: Session;
  onOpen: (item: SiloItem) => void;
  /** Opens the row's full page. Omit to render the row without Explore all. */
  onExplore?: (rail: HomeRail) => void;
  /** False for a row far from focus: it keeps its heading and height but renders no cards. */
  live?: boolean;
  /** Card position to build the first window around, when focus is about to be restored there. */
  initialAnchor?: number;
  /**
   * Move the row by translating its strip of cards (a compositor animation) and not by
   * scrolling it. Used where the screen drives the row itself, as Home does.
   */
  slide?: boolean;
}) {
  const isContinueWatching = rail.title.toLocaleLowerCase().includes("continue watching");
  const landscape = Boolean(rail.featured || isContinueWatching);
  // Android offersExploreAll: non-featured rows with cards and a server section id.
  const explorable = Boolean(onExplore && rail.sectionId && !rail.featured && rail.items.length > 0);
  const items = useMemo(
    () => (onExplore ? rail.items.slice(0, SECTION_ROW_MAX_ITEMS) : rail.items),
    [onExplore, rail.items]
  );
  /** Position of the card that last had focus in this row; the rendered window follows it. */
  const [anchor, setAnchor] = useState(initialAnchor);
  const reach = landscape ? WINDOW_WIDE : WINDOW_POSTER;
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  /** Height of the track with cards in it, kept so the row holds its place while it has none. */
  const liveHeight = useRef(0);
  useLayoutEffect(() => {
    if (live && trackRef.current) liveHeight.current = trackRef.current.offsetHeight;
  });

  // One stable handler per item, so a card re-renders only when its own data changes.
  const openHandlers = useMemo(
    () => new Map(items.map(item => [item.Id, () => onOpen(item)] as const)),
    [items, onOpen]
  );

  // TV: Continue Watching is the first row reached and its wide art is the costliest to decode.
  // Measured cold it ran ~100ms/frame vs ~40ms once cached, so fetch + decode its first cards in
  // the background (mostly while the startup splash still covers Home), two at a time.
  useEffect(() => {
    if (!isContinueWatching || !isTvDevice()) return;
    let cancelled = false;
    const urls = items.slice(0, CW_WARM_COUNT).map(item => cardBackdropUrl(session, item)).filter(Boolean);
    (async () => {
      for (let i = 0; i < urls.length && !cancelled; i += 2) {
        await Promise.all(urls.slice(i, i + 2).map(warmArtworkImage));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContinueWatching, rail.id, items.length, session]);

  function followFocus(event: FocusEvent<HTMLDivElement>) {
    const wrap = (event.target as HTMLElement).closest<HTMLElement>(".media-card-wrap");
    const strip = stripRef.current;
    if (!wrap || !strip || wrap.parentElement !== strip) return;
    const slot = Array.prototype.indexOf.call(strip.children, wrap) as number;
    if (slot >= 0) setAnchor(slot);
  }

  return (
    <section data-rail-id={rail.id} className={`media-rail ${isContinueWatching ? "continue-watching-rail" : ""} ${landscape ? "wide-media-rail" : ""}`}>
      <h2>{rail.title}</h2>
      <div
        ref={trackRef}
        className={`rail-track ${landscape ? "wide-rail" : ""}`}
        data-slide={slide ? "true" : undefined}
        style={!live && liveHeight.current ? { minHeight: liveHeight.current } : undefined}
        onFocusCapture={followFocus}
      >
        {/* The strip is the row's cards. Without `slide` it is display: contents and the track
            lays the cards out and scrolls as before. */}
        <div ref={stripRef} className="rail-strip">
        {items.map((item, index) => (
          live && index >= anchor - reach && index <= anchor + reach ? (
            <MediaCard
              key={`${rail.id}-${item.Id}`}
              session={session}
              item={item}
              image={landscape ? cardBackdropUrl(session, item) : imageUrl(session, item)}
              landscape={landscape}
              onOpen={openHandlers.get(item.Id)!}
            />
          ) : <div key={`${rail.id}-${item.Id}`} className="media-card-wrap" />
        ))}
        {explorable ? (
          <div className="media-card-wrap">
            <button
              type="button"
              data-tv-focusable="true"
              data-explore-rail={rail.id}
              className={`media-card explore-all-card ${landscape ? "landscape" : ""}`}
              aria-label={`Explore all ${rail.title}`}
              onClick={() => onExplore?.(rail)}
            >
              <div className="media-card-art explore-all-art">
                <span className="explore-all-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
                </span>
                <span className="explore-all-label">Explore all</span>
              </div>
            </button>
          </div>
        ) : null}
        </div>
      </div>
    </section>
  );
});
