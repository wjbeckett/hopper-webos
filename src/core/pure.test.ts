import { describe, expect, it } from "vitest";
import { firstEpisodeOfSeason, nextEpisodeAfter } from "./episodeNavigation";
import { stripPlaylistToken, withPlaylistToken } from "./hlsPlaylistToken";
import { markerAction, resumePositionWithRewind } from "./playerSettings";
import type { SiloItem } from "../types";

const episode = (season: number, number: number): SiloItem => ({ Id: `s${season}e${number}`, Name: `E${number}`, Type: "Episode", ParentIndexNumber: season, IndexNumber: number } as SiloItem);

describe("next episode", () => {
  const episodes = [episode(2, 1), episode(1, 3), episode(1, 1), episode(1, 2)];

  it("is the next one in the same season, whatever order the list is in", () => {
    expect(nextEpisodeAfter(episodes, 1, 1)?.Id).toBe("s1e2");
  });

  it("moves on to the next season after the last episode", () => {
    expect(nextEpisodeAfter(episodes, 1, 3)?.Id).toBe("s2e1");
  });

  it("is null after the last episode of the series", () => {
    expect(nextEpisodeAfter(episodes, 2, 1)).toBeNull();
  });

  it("starts a season at its lowest-numbered episode", () => {
    expect(firstEpisodeOfSeason([episode(1, 3), episode(1, 1)])?.Id).toBe("s1e1");
  });
});

describe("resume position", () => {
  it("rewinds by the configured seconds", () => {
    expect(resumePositionWithRewind(100, 10)).toBe(90);
  });

  it("never goes below the start", () => {
    expect(resumePositionWithRewind(4, 10)).toBe(0);
  });

  it("leaves a start over, no position or a zero position alone", () => {
    expect(resumePositionWithRewind(100, 10, true)).toBe(100);
    expect(resumePositionWithRewind(undefined, 10)).toBeUndefined();
    expect(resumePositionWithRewind(0, 10)).toBe(0);
  });

  it("treats a negative or broken rewind as none", () => {
    expect(resumePositionWithRewind(100, -5)).toBe(100);
    expect(resumePositionWithRewind(100, Number.NaN)).toBe(100);
  });
});

describe("skip markers", () => {
  it("follows the intro mode for intros", () => {
    expect(markerAction("intro", "never", false)).toBe("ignore");
    expect(markerAction("intro", "ask", false)).toBe("offer");
    expect(markerAction("intro", "always", false)).toBe("skip");
  });

  it("skips credits only when auto-skip is on", () => {
    expect(markerAction("credits", "always", false)).toBe("offer");
    expect(markerAction("credits", "never", true)).toBe("skip");
  });
});

describe("playlist token", () => {
  const playlist = "#EXTM3U\nseg0.m4s?st=abc.DEF-1\nseg1.m4s?st=abc.DEF-1\nseg2.m4s?st=abc.DEF-1\n";

  it("strips a token repeated on every segment and puts it back on requests", () => {
    const slim = stripPlaylistToken(playlist);
    expect(slim.token).toBe("abc.DEF-1");
    expect(slim.text).not.toContain("st=");
    expect(withPlaylistToken("seg0.m4s", slim.token)).toBe("seg0.m4s?st=abc.DEF-1");
    expect(withPlaylistToken("seg0.m4s?x=1", slim.token)).toBe("seg0.m4s?x=1&st=abc.DEF-1");
  });

  it("leaves a playlist with the token only once untouched", () => {
    const text = "#EXTM3U\nseg0.m4s?st=abc\n";
    expect(stripPlaylistToken(text)).toEqual({ text, token: null });
  });

  it("does not add a second token to a URL that has one", () => {
    expect(withPlaylistToken("seg.m4s?st=other", "abc")).toBe("seg.m4s?st=other");
  });
});
