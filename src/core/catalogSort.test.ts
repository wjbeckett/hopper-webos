import { describe, expect, it } from "vitest";
import { sortDirectionLabel, sortOptions, sortRelevance } from "./catalogSort";

const ids = (relevance: ReturnType<typeof sortRelevance>, shown: string[] | null = ["imdb", "tmdb"], keep?: string) =>
  sortOptions(relevance, { includePersonalized: true, shownRatingSources: shown ? new Set(shown) : null, keep }).map(field => field.id);

describe("library sort options (#174)", () => {
  it("gives a series library the two episode sorts, and a movie library neither", () => {
    expect(ids(sortRelevance(["series"]))).toEqual(expect.arrayContaining(["last_air_date", "latest_episode_added"]));
    expect(ids(sortRelevance(["movies"]))).not.toEqual(expect.arrayContaining(["last_air_date"]));
    expect(ids(sortRelevance(["movies"]))).not.toContain("latest_episode_added");
  });

  it("lists the web's options in the web's order for a movie library", () => {
    expect(ids(sortRelevance(["movies"]))).toEqual([
      "title", "added_at", "release_date", "year", "content_rating", "runtime", "rating_imdb", "rating_tmdb",
      "resolution", "bitrate", "progress", "date_viewed", "plays"
    ]);
  });

  it("offers Rotten Tomatoes sorts only while the server shows them", () => {
    expect(ids(sortRelevance(["movies"]), ["imdb", "tmdb", "rt_critic"])).toContain("rating_rt_critic");
    expect(ids(sortRelevance(["movies"]), ["imdb", "tmdb", "rt_critic"])).not.toContain("rating_rt_audience");
    expect(ids(sortRelevance(["movies"]), null)).not.toContain("rating_rt_critic");
  });

  it("keeps the sort in use listed even where the list wouldn't offer it", () => {
    expect(ids(sortRelevance(["movies"]), null, "rating_rt_critic")).toContain("rating_rt_critic");
  });

  it("follows the chosen side of a mixed library", () => {
    expect(ids(sortRelevance(["mixed"], "Series"))).toContain("latest_episode_added");
    expect(ids(sortRelevance(["mixed"]))).not.toContain("latest_episode_added");
    expect(ids(sortRelevance(["mixed"]))).not.toContain("last_air_date");
  });

  it("gives audiobooks their own sorts and no video ones", () => {
    const books = ids(sortRelevance(["audiobooks"]));
    expect(books).toEqual(expect.arrayContaining(["author", "narrator", "series", "runtime"]));
    expect(books).not.toContain("resolution");
  });

  it("names directions as the web does", () => {
    expect(sortDirectionLabel("plays", "desc")).toBe("Most");
    expect(sortDirectionLabel("latest_episode_added", "asc")).toBe("Oldest");
    expect(sortDirectionLabel("runtime", "desc")).toBe("Longest");
    expect(sortDirectionLabel("content_rating", "asc")).toBe("A–Z");
  });
});
