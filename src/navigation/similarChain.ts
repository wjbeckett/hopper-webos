/**
 * Where a More Like This pick goes (#177; Android TV #737, tvOS #959). The first pick from a
 * title opens a new page, so Back returns to the title it came from. Later picks replace that
 * page, so Back from any depth returns to the title the chain started from. Picking the starting
 * title again goes back to it; picking the title already showing does nothing (null).
 */
export type ChainPage<T> = { item: { Id: string }; chainStart?: T };

export function nextInChain<T extends ChainPage<T>>(from: T, open: T): T | null {
  const start = from.chainStart ?? from;
  if (open.item.Id === start.item.Id) return start;
  if (open.item.Id === from.item.Id) return null;
  return { ...open, chainStart: start };
}
