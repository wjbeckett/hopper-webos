import { useCallback, useEffect, useMemo, useState } from "react";
import { getHomeRails } from "../api/silo";
import { FeaturedRailsScreen } from "../components/FeaturedRailsScreen";
import { focusFirstContentCard } from "../navigation/spatial";
import { arrangeHomeRails, readHomeSectionLayout } from "../core/homeSections";
import { useWatchStateRefresh } from "../core/watchState";
import type { HomeRail, Session, SiloItem } from "../types";
import { LoadingState } from "../components/LoadingState";

/**
 * The last Home rows per server and profile. Home unmounts whenever a details page or the
 * player opens; without this, every Back refetched the rows behind a loading screen. With it,
 * Home is shown at once from memory and refreshed in the background.
 */
const railsCache = new Map<string, HomeRail[]>();
const cacheKey = (session: Session) => `${session.serverUrl}|${session.userId}|${session.profileId ?? ""}`;

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

export function HomeScreen({
  session,
  onOpen,
  onExplore
}: {
  session: Session;
  onOpen: (item: SiloItem) => void;
  onExplore?: (rail: HomeRail) => void;
}) {
  const key = cacheKey(session);
  const [rails, setRails] = useState<HomeRail[]>(() => railsCache.get(key) ?? []);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !railsCache.has(key));

  useEffect(() => {
    let alive = true;
    const cached = railsCache.get(key);
    if (cached) setRails(cached);
    setLoading(!cached);
    getHomeRails(session)
      .then((next) => {
        const merged = keepUnchanged(railsCache.get(key) ?? [], next);
        railsCache.set(key, merged);
        if (alive) { setRails(merged); setError(""); }
      })
      // A failed refresh keeps the rows already on screen.
      .catch((err) => { if (alive && !railsCache.has(key)) setError(err instanceof Error ? err.message : "Failed to load home"); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const refreshRails = useCallback(() => getHomeRails(session)
    .then(next => {
      const merged = keepUnchanged(railsCache.get(key) ?? [], next);
      railsCache.set(key, merged);
      setRails(merged);
    })
    .catch(() => undefined), [session, key]);

  useWatchStateRefresh(refreshRails, 300, 20_000);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  const arranged = useMemo(() => arrangeHomeRails(rails, readHomeSectionLayout(session)), [rails, session]);

  if (loading) return <LoadingState label="Loading your Silo" />;

  return (
    <FeaturedRailsScreen
      rails={arranged}
      session={session}
      onOpen={onOpen}
      onExplore={onExplore}
      error={error}
      emptyTitle="Your library will show up here"
      emptyDescription="Connect a library on your Silo server to get started."
      restoreKey={`home|${key}`}
    />
  );
}
