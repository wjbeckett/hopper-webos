import type { SiloItem } from "../types";

/**
 * What a box set's Play starts (#171, Android TV's BoxSetViewModel): the film in progress, else
 * the first unwatched one, else the first; "Continue" when one is in progress or some are watched.
 */
export function boxSetPlayTarget(items: SiloItem[]): { item: SiloItem; position: number; label: "Play" | "Continue" } | null {
  if (!items.length) return null;
  const inProgress = items.find(item => item.UserData?.Played !== true && (item.UserData?.PlaybackPositionTicks ?? 0) > 30 * 10_000_000);
  if (inProgress) return { item: inProgress, position: (inProgress.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000, label: "Continue" };
  const unwatched = items.find(item => item.UserData?.Played !== true);
  if (unwatched) return { item: unwatched, position: 0, label: items.some(item => item.UserData?.Played === true) ? "Continue" : "Play" };
  return { item: items[0], position: 0, label: "Play" };
}

/** "3 films · 2001–2003". */
export function boxSetFacts(count: number, firstYear?: number, lastYear?: number) {
  const films = `${count} ${count === 1 ? "film" : "films"}`;
  const years = firstYear && lastYear && firstYear !== lastYear ? `${firstYear}–${lastYear}` : firstYear ? String(firstYear) : "";
  return [films, years].filter(Boolean).join(" · ");
}
