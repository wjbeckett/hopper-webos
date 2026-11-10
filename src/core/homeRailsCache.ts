import type { HomeRail, Session } from "../types";

/**
 * The last Home rows per server and profile, kept in memory for the life of the app.
 *
 * Home unmounts whenever a details page or the player opens. Without this, every Back
 * refetched the rows behind a loading screen, and the player fetched all of Home again just
 * to fill its On Deck row while the stream was starting.
 */
const cache = new Map<string, HomeRail[]>();

export const homeRailsKey = (session: Session) => `${session.serverUrl}|${session.userId}|${session.profileId ?? ""}`;

export function cachedHomeRails(session: Session): HomeRail[] | undefined {
  return cache.get(homeRailsKey(session));
}

/** Stores freshly fetched rows and returns them with unchanged rows and items kept by identity. */
export function storeHomeRails(session: Session, next: HomeRail[]): HomeRail[] {
  const key = homeRailsKey(session);
  const merged = keepUnchanged(cache.get(key) ?? [], next);
  cache.set(key, merged);
  return merged;
}

/**
 * Keeps the objects from `previous` wherever the refreshed data is identical, and returns
 * `previous` itself when nothing changed. Home is refreshed on a timer and on server events;
 * handing React the same rows and items means a refresh with no changes re-renders nothing.
 */
function keepUnchanged(previous: HomeRail[], next: HomeRail[]): HomeRail[] {
  const before = new Map(previous.map(rail => [rail.id, rail] as const));
  let same = previous.length === next.length;
  const merged = next.map((rail, railIndex) => {
    const old = before.get(rail.id);
    if (!old) { same = false; return rail; }
    const oldItems = new Map(old.items.map(item => [item.Id, item] as const));
    let itemsSame = old.items.length === rail.items.length;
    const items = rail.items.map((item, index) => {
      const oldItem = oldItems.get(item.Id);
      if (oldItem && JSON.stringify(oldItem) === JSON.stringify(item)) {
        if (old.items[index] !== oldItem) itemsSame = false;
        return oldItem;
      }
      itemsSame = false;
      return item;
    });
    if (itemsSame && JSON.stringify({ ...old, items: undefined }) === JSON.stringify({ ...rail, items: undefined })) {
      if (previous[railIndex] !== old) same = false;
      return old;
    }
    same = false;
    return { ...rail, items: itemsSame ? old.items : items };
  });
  return same ? previous : merged;
}
