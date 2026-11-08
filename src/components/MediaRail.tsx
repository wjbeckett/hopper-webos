import { cardBackdropUrl, imageUrl } from "../api/silo";
import type { HomeRail, Session, SiloItem } from "../types";
import { MediaCard } from "./MediaCard";

// Android SECTION_ROW_MAX_ITEMS: a row shows at most 20 cards; the rest live
// on the row's full page behind the trailing "Explore all" card.
const SECTION_ROW_MAX_ITEMS = 20;

export function MediaRail({
  rail,
  session,
  onOpen,
  onExplore
}: {
  rail: HomeRail;
  session: Session;
  onOpen: (item: SiloItem) => void;
  /** Opens the row's full page. Omit to render the row without Explore all. */
  onExplore?: (rail: HomeRail) => void;
}) {
  const isContinueWatching = rail.title.toLocaleLowerCase().includes("continue watching");
  const landscape = Boolean(rail.featured || isContinueWatching);
  // Android offersExploreAll: non-featured rows with cards and a server section id.
  const explorable = Boolean(onExplore && rail.sectionId && !rail.featured && rail.items.length > 0);
  const items = onExplore ? rail.items.slice(0, SECTION_ROW_MAX_ITEMS) : rail.items;

  return (
    <section data-rail-id={rail.id} className={`media-rail ${isContinueWatching ? "continue-watching-rail" : ""} ${landscape ? "wide-media-rail" : ""}`}>
      <h2>{rail.title}</h2>
      <div className={`rail-track ${landscape ? "wide-rail" : ""}`}>
        {items.map((item) => (
          <MediaCard
            key={`${rail.id}-${item.Id}`}
            session={session}
            item={item}
            image={landscape ? cardBackdropUrl(session, item) : imageUrl(session, item)}
            landscape={landscape}
            onOpen={() => onOpen(item)}
          />
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
    </section>
  );
}
