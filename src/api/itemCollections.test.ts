import { describe, expect, it } from "vitest";
import { parseItemCollections } from "./silo";

const server = { id: "c1", source: "library", title: "Marvel", poster_url: "/p.jpg", poster_is_collage: false, item_count: 12, library_id: "1" };
const personal = { id: "c2", source: "user", title: "Rainy days", poster_url: "", poster_is_collage: true, item_count: 4, creator_profile_id: "3" };

describe("\"Also in\" on a title's page (#206)", () => {
  it("lists every collection as a card, with no preview when there are several", () => {
    const result = parseItemCollections({ items: [server, personal], preview_items: [{ id: "movie:x", title: "X" } as never] });
    expect(result.collections.map(card => [card.Id, card.Type, card.CollectionCard?.source])).toEqual([["c1", "Collection", "library"], ["c2", "Collection", "user"]]);
    expect(result.preview).toEqual([]);
  });

  it("keeps the preview titles when the title is in one collection", () => {
    const result = parseItemCollections({ items: [server], preview_items: [{ id: "movie:a", title: "A" }, { id: "movie:b", title: "B" }] as never });
    expect(result.collections).toHaveLength(1);
    expect(result.preview.map(item => item.Id)).toEqual(["movie:a", "movie:b"]);
  });

  it("leaves out a card it couldn't open, and copes with an empty answer", () => {
    expect(parseItemCollections({ items: [{ ...server, library_id: undefined }] }).collections).toEqual([]);
    expect(parseItemCollections({})).toEqual({ collections: [], preview: [] });
  });
});
