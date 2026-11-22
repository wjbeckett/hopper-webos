import { useEffect, useState } from "react";
import { getItemCollections } from "../api/silo";
import type { Session, SiloItem } from "../types";
import { MediaRail } from "./MediaRail";

/**
 * "Also in" on a title's page (#206): the collections the title is in, as collection cards. When
 * there is only one, a row of its other titles named after it, with Explore all opening it, as the
 * server suggests (`preview_items`). Nothing when the title is in none.
 */
export function AlsoInSection({ session, itemId, onOpen }: { session: Session; itemId: string; onOpen: (item: SiloItem) => void }) {
  const [result, setResult] = useState<{ collections: SiloItem[]; preview: SiloItem[] }>({ collections: [], preview: [] });

  useEffect(() => {
    let alive = true;
    setResult({ collections: [], preview: [] });
    void getItemCollections(session, itemId).then(next => { if (alive) setResult(next); });
    return () => { alive = false; };
  }, [session, itemId]);

  const { collections, preview } = result;
  if (!collections.length) return null;
  if (collections.length === 1 && preview.length) {
    const collection = collections[0];
    return (
      <MediaRail
        rail={{ id: `also-in-${collection.Id}`, title: collection.Name ?? "Collection", sectionId: `also-in-${collection.Id}`, items: preview }}
        session={session}
        onOpen={onOpen}
        onExplore={() => onOpen(collection)}
        slide
      />
    );
  }
  return <MediaRail rail={{ id: "also-in", title: "Also In", items: collections }} session={session} onOpen={onOpen} slide />;
}
