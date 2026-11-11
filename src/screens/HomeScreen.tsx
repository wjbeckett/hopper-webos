import { useCallback, useEffect, useMemo, useState } from "react";
import { getHomeRails } from "../api/silo";
import { FeaturedRailsScreen } from "../components/FeaturedRailsScreen";
import { focusFirstContentCard } from "../navigation/spatial";
import { arrangeHomeRails, readHomeSectionLayout } from "../core/homeSections";
import { cachedHomeRails, homeRailsKey, storeHomeRails } from "../core/homeRailsCache";
import { useWatchStateRefresh } from "../core/watchState";
import type { HomeRail, Session, SiloItem } from "../types";
import { LoadingState } from "../components/LoadingState";

export function HomeScreen({
  session,
  onOpen,
  onExplore
}: {
  session: Session;
  onOpen: (item: SiloItem) => void;
  onExplore?: (rail: HomeRail) => void;
}) {
  const key = homeRailsKey(session);
  const [rails, setRails] = useState<HomeRail[]>(() => cachedHomeRails(session) ?? []);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !cachedHomeRails(session));

  useEffect(() => {
    let alive = true;
    const cached = cachedHomeRails(session);
    if (cached) setRails(cached);
    setLoading(!cached);
    getHomeRails(session)
      .then((next) => {
        const merged = storeHomeRails(session, next);
        if (alive) { setRails(merged); setError(""); }
      })
      // A failed refresh keeps the rows already on screen.
      .catch((err) => { if (alive && !cachedHomeRails(session)) setError(err instanceof Error ? err.message : "Failed to load home"); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const refreshRails = useCallback(() => getHomeRails(session)
    .then(next => setRails(storeHomeRails(session, next)))
    .catch(() => undefined), [session]);

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
