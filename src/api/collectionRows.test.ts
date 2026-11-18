import { describe, expect, it } from "vitest";
import { sectionCards } from "./silo";

describe("rows of collections (#170)", () => {
  it("turns a row's collections into collection cards", () => {
    const cards = sectionCards({ items: [], collections: [
      { id: 7, source: "library", title: "Marvel", poster_url: "/p.jpg", backdrop_url: "/b.jpg", item_count: 12, library_id: 3 },
      { id: "c-2", source: "user", title: "Date night", poster_url: "", item_count: 1 }
    ] });
    expect(cards).toMatchObject([
      { Id: "7", Name: "Marvel", Type: "Collection", PosterUrl: "/p.jpg", BackdropUrl: "/b.jpg", CollectionCard: { source: "library", libraryId: 3, itemCount: 12 } },
      { Id: "c-2", Name: "Date night", Type: "Collection", PosterUrl: undefined, CollectionCard: { source: "user", libraryId: undefined, itemCount: 1 } }
    ]);
  });

  it("uses the poster for the hero when the collection has no backdrop", () => {
    const [card] = sectionCards({ collections: [{ id: 1, source: "library", title: "A", poster_url: "/p.jpg", item_count: 2, library_id: 1 }] });
    expect(card.BackdropUrl).toBe("/p.jpg");
  });

  it("leaves out cards it can't open", () => {
    const cards = sectionCards({ collections: [
      { id: 1, source: "library", title: "No library", item_count: 2 },
      { id: 2, source: "plugin", title: "Unknown source", item_count: 2 },
      { source: "user", title: "No id", item_count: 2 },
      { id: 4, source: "user", item_count: 2 }
    ] });
    expect(cards).toEqual([]);
  });

  it("keeps an ordinary row's titles", () => {
    const cards = sectionCards({ items: [{ content_id: "movie-1", type: "movie", title: "Film" } as never] });
    expect(cards.map(card => card.Id)).toEqual(["movie-1"]);
  });
});
