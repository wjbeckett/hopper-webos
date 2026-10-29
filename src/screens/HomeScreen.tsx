import { useEffect, useState } from "react";
import { getHomeRails } from "../api/silo";
import { FeaturedRailsScreen } from "../components/FeaturedRailsScreen";
import { focusFirstContentCard } from "../navigation/spatial";
import type { HomeRail, Session, SiloItem } from "../types";

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

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, rails]);

  if (loading) return <div className="screen-state">Loading your Silo…</div>;

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
