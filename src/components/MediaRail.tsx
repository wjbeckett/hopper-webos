import { backdropUrl, imageUrl } from "../api/silo";
import type { HomeRail, Session, SiloItem } from "../types";
import { MediaCard } from "./MediaCard";

export function MediaRail({
  rail,
  session,
  onOpen
}: {
  rail: HomeRail;
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const isContinueWatching = rail.title.toLocaleLowerCase().includes("continue watching");
  const landscape = Boolean(rail.featured || isContinueWatching);

  return (
    <section data-rail-id={rail.id} className={`media-rail ${isContinueWatching ? "continue-watching-rail" : ""} ${landscape ? "wide-media-rail" : ""}`}>
      <h2>{rail.title}</h2>
      <div className={`rail-track ${landscape ? "wide-rail" : ""}`}>
        {rail.items.map((item) => (
          <MediaCard
            key={`${rail.id}-${item.Id}`}
            session={session}
            item={item}
            image={landscape ? backdropUrl(session, item) : imageUrl(session, item)}
            landscape={landscape}
            onOpen={() => onOpen(item)}
          />
        ))}
      </div>
    </section>
  );
}
