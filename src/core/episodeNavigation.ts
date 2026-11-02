import type { SiloItem } from "../types";

export function nextEpisodeAfter(episodes: SiloItem[], currentSeason: number, currentEpisode: number): SiloItem | null {
  return episodes
    .filter(episode => episode.ParentIndexNumber != null && episode.IndexNumber != null && (
      episode.ParentIndexNumber > currentSeason ||
      (episode.ParentIndexNumber === currentSeason && episode.IndexNumber > currentEpisode)
    ))
    .sort((left, right) => left.ParentIndexNumber! - right.ParentIndexNumber! || left.IndexNumber! - right.IndexNumber!)[0] ?? null;
}

export function firstEpisodeOfSeason(episodes: SiloItem[]): SiloItem | null {
  return episodes
    .filter(episode => episode.IndexNumber != null)
    .sort((left, right) => left.IndexNumber! - right.IndexNumber!)[0] ?? null;
}
