import { useCallback, useEffect, useState } from "react";
import { getHomeRails } from "../api/silo";
import { FeaturedRailsScreen } from "../components/FeaturedRailsScreen";
import { focusFirstContentCard } from "../navigation/spatial";
import { useWatchStateRefresh } from "../core/watchState";
import type { HomeRail, Session, SiloItem } from "../types";
import { LoadingState } from "../components/LoadingState";

export function HomeScreen({
  session,
  onOpen
}: {
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const [rails, setRails] = useState<HomeRail[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getHomeRails(session)
      .then((next) => alive && setRails(next))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load home"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [session]);

  const refreshRails = useCallback(() => getHomeRails(session)
    .then(next => setRails(next))
    .catch(() => undefined), [session]);

  useWatchStateRefresh(refreshRails, 300, 20_000);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  if (loading) return <LoadingState label="Loading your Silo" />;

  return (
    <FeaturedRailsScreen
      rails={rails}
      session={session}
      onOpen={onOpen}
      error={error}
      emptyTitle="Your library will show up here"
      emptyDescription="Connect a library on your Silo server to get started."
    />
  );
}
