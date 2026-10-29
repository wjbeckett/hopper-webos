import { useEffect, useState } from "react";
import { getForYouRails } from "../api/silo";
import { FeaturedRailsScreen } from "../components/FeaturedRailsScreen";
import { focusFirstContentCard } from "../navigation/spatial";
import type { HomeRail, Session, SiloItem } from "../types";

export function ForYouScreen({
  session,
  onOpen
}: {
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const [rails, setRails] = useState<HomeRail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    getForYouRails(session)
      .then(next => { if (alive) setRails(next); })
      .catch(cause => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not load recommendations.");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, rails]);

  if (loading) return <div className="screen-state">Loading recommendations…</div>;

  return (
    <FeaturedRailsScreen
      rails={rails}
      session={session}
      onOpen={onOpen}
      error={error}
      emptyMark="✦"
      emptyTitle="Nothing to recommend yet"
      emptyDescription="As you watch more, personalized picks will appear here."
    />
  );
}
