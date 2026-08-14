import { imageUrl } from "../api/silo";
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
  return (
    <section className="media-rail">
      <h2>{rail.title}</h2>
      <div className="rail-track">
        {rail.items.map((item) => (
          <MediaCard
            key={`${rail.id}-${item.Id}`}
            item={item}
            image={imageUrl(session, item)}
            landscape={rail.featured}
            onOpen={() => onOpen(item)}
          />
        ))}
      </div>
    </section>
  );
}
