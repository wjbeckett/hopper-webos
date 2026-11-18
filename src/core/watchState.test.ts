import { describe, expect, it, vi } from "vitest";
import type { SiloItem } from "../types";
import { applyResumeState, applyServerUserData, publishPlaybackSettled, subscribePlaybackSettled } from "./watchState";

const film: SiloItem = { Id: "movie-1", Name: "Film", Type: "Movie", RunTimeTicks: 5_220 * 10_000_000, UserData: { Played: false, PlaybackPositionTicks: 2_617 * 10_000_000, PlayedPercentage: 50, IsFavorite: true } };

describe("the page after the player (#165)", () => {
  it("replaces the exit guess with the server's resume point", () => {
    // Start Over, Back at 0:57: the server keeps 43:37 (under the minimum resume share).
    const guess = applyResumeState(film, 57);
    const shown = applyServerUserData(guess, { ...film, UserData: { Played: false, PlaybackPositionTicks: 2_617 * 10_000_000, PlayedPercentage: 50 } });
    expect(shown.UserData).toMatchObject({ PlaybackPositionTicks: 2_617 * 10_000_000, IsFavorite: true });
  });

  it("clears the guess when the server kept no progress", () => {
    const guess = applyResumeState({ ...film, UserData: undefined }, 48);
    const shown = applyServerUserData(guess, { ...film, UserData: undefined });
    expect(shown.UserData).toMatchObject({ Played: false, PlaybackPositionTicks: 0, PlayedPercentage: 0 });
  });

  it("shows a title stopped in its credits as watched when the server marked it", () => {
    const guess = applyResumeState(film, 5_100);
    const shown = applyServerUserData(guess, { ...film, UserData: { Played: true, PlaybackPositionTicks: 0, PlayedPercentage: 100 } });
    expect(shown.UserData).toMatchObject({ Played: true, PlaybackPositionTicks: 0 });
  });

  it("tells the pages that the stop has landed", () => {
    const listener = vi.fn();
    const stop = subscribePlaybackSettled(listener);
    publishPlaybackSettled(["episode-1", "series-1"]);
    stop();
    publishPlaybackSettled(["episode-2"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(["episode-1", "series-1"]);
  });
});
